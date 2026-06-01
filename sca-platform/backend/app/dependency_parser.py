from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import quote


@dataclass
class ParsedComponent:
    ecosystem: str
    name: str
    version: str = ""
    scope: str = "runtime"
    source_path: str = ""
    normalized_name: str = ""
    package_manager: str = ""
    purl: str = ""
    cpe: str = ""
    group_id: str = ""
    artifact_id: str = ""
    version_normalized: str = ""
    dependency_type: str = "direct"
    source_file: str = ""
    evidence_level: str = "manifest"
    evidence_file: str = ""
    evidence_line: int = 0
    evidence_text: str = ""
    detected_by: str = "manifest"
    confidence_score: float = 0.7
    version_conflict: bool = False
    conflict_reason: str = ""

    @property
    def key(self) -> str:
        return f"{self.ecosystem}:{self.name}:{self.version}:{self.scope}:{self.source_path}"


@dataclass(frozen=True)
class ParsedDependency:
    child_key: str
    parent_key: str | None = None
    relationship_type: str = "direct"


@dataclass
class ParseResult:
    components: list[ParsedComponent] = field(default_factory=list)
    dependencies: list[ParsedDependency] = field(default_factory=list)
    logs: list[str] = field(default_factory=list)
    manifest_versions: dict[tuple[str, str], tuple[str, str]] = field(default_factory=dict)


def _relative(path: Path, root: Path) -> str:
    try:
        return str(path.relative_to(root))
    except ValueError:
        return str(path)


def _normalize_pypi_name(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def _normalize_version(version: str) -> str:
    value = version.strip()
    value = re.sub(r"^[~^<>=! ]+", "", value)
    return value.split(",", 1)[0].strip()


def _line_evidence(path: Path, needle: str) -> tuple[int, str]:
    lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    for index, raw_line in enumerate(lines, start=1):
        if needle in raw_line:
            return index, raw_line.strip()
    return 0, ""


def _normalize_component(component: ParsedComponent) -> ParsedComponent:
    component.package_manager = component.package_manager or component.ecosystem
    component.source_file = component.source_file or component.source_path
    component.evidence_file = component.evidence_file or component.source_path
    component.version_normalized = component.version_normalized or _normalize_version(component.version)
    if component.ecosystem == "pypi":
        component.normalized_name = component.normalized_name or _normalize_pypi_name(component.name)
    else:
        component.normalized_name = component.normalized_name or component.name.lower()

    if component.ecosystem == "maven":
        group_id, _, artifact_id = component.name.partition(":")
        component.group_id = component.group_id or group_id
        component.artifact_id = component.artifact_id or artifact_id
        if component.group_id and component.artifact_id and component.version_normalized:
            component.purl = component.purl or f"pkg:maven/{component.group_id}/{component.artifact_id}@{component.version_normalized}"
    elif component.ecosystem == "npm" and component.version_normalized:
        component.purl = component.purl or f"pkg:npm/{quote(component.normalized_name, safe='/')}@{component.version_normalized}"
    elif component.ecosystem == "pypi" and component.version_normalized:
        component.purl = component.purl or f"pkg:pypi/{component.normalized_name}@{component.version_normalized}"
    elif component.ecosystem == "go" and component.version_normalized:
        component.purl = component.purl or f"pkg:golang/{component.name}@{component.version_normalized}"
    elif component.ecosystem == "docker" and component.version_normalized:
        component.purl = component.purl or f"pkg:docker/{component.name}@{component.version_normalized}"
    return component


def _add_component(result: ParseResult, component: ParsedComponent) -> None:
    component = _normalize_component(component)
    if component.key not in {item.key for item in result.components}:
        result.components.append(component)
    result.dependencies.append(ParsedDependency(child_key=component.key, relationship_type=component.dependency_type))


def _npm_manifest_deps(path: Path) -> dict[str, tuple[str, str]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    groups = {
        "dependencies": "runtime",
        "devDependencies": "dev",
        "peerDependencies": "peer",
        "optionalDependencies": "optional",
    }
    deps: dict[str, tuple[str, str]] = {}
    for group, scope in groups.items():
        raw_deps = data.get(group) or {}
        if isinstance(raw_deps, dict):
            deps.update({str(name): (str(version), scope) for name, version in raw_deps.items()})
    return deps


def _parse_package_json(path: Path, root: Path, result: ParseResult) -> None:
    source_path = _relative(path, root)
    deps = _npm_manifest_deps(path)
    result.manifest_versions.update({("npm", name): (version, source_path) for name, (version, _scope) in deps.items()})
    if (path.parent / "package-lock.json").exists() or (path.parent / "yarn.lock").exists():
        result.logs.append(f"发现 npm lock 文件，{source_path} 仅用于直接依赖证据")
        return
    for name, (version, scope) in deps.items():
        line, text = _line_evidence(path, name)
        _add_component(
            result,
            ParsedComponent(
                "npm",
                name,
                version,
                scope,
                source_path,
                dependency_type="direct",
                evidence_level="manifest",
                evidence_line=line,
                evidence_text=text,
                detected_by="manifest",
                confidence_score=0.72,
            ),
        )


def _parse_package_lock(path: Path, root: Path, result: ParseResult) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    source_path = _relative(path, root)
    manifest_deps = _npm_manifest_deps(path.parent / "package.json") if (path.parent / "package.json").exists() else {}
    result.manifest_versions.update({("npm", name): (version, "package.json") for name, (version, _scope) in manifest_deps.items()})
    packages = data.get("packages") if isinstance(data, dict) else {}
    if not isinstance(packages, dict):
        return
    for raw_name, payload in packages.items():
        if not raw_name or not isinstance(payload, dict) or "node_modules/" not in raw_name:
            continue
        name = raw_name.rsplit("node_modules/", 1)[-1]
        version = str(payload.get("version") or "")
        manifest_version, manifest_file = result.manifest_versions.get(("npm", name), ("", "package.json"))
        scope = manifest_deps.get(name, ("", "dev" if payload.get("dev") else "runtime"))[1]
        dependency_type = "direct" if name in manifest_deps else "indirect"
        conflict = bool(manifest_version and _normalize_version(manifest_version) != _normalize_version(version))
        line, text = _line_evidence(path, name)
        _add_component(
            result,
            ParsedComponent(
                "npm",
                name,
                version,
                scope,
                source_path,
                dependency_type=dependency_type,
                evidence_level="lock",
                evidence_line=line,
                evidence_text=text,
                detected_by="lock",
                confidence_score=0.95 if dependency_type == "direct" else 0.88,
                version_conflict=conflict,
                conflict_reason=f"{manifest_file} 声明 {manifest_version}，package-lock.json 锁定 {version}" if conflict else "",
            ),
        )


REQ_RE = re.compile(r"^\s*([A-Za-z0-9_.-]+)\s*(?:==|>=|<=|~=|>|<|=)?\s*([^;#\s]+)?")


def _parse_requirements(path: Path, root: Path, result: ParseResult) -> None:
    source_path = _relative(path, root)
    for line_no, raw_line in enumerate(path.read_text(encoding="utf-8", errors="ignore").splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#") or line.startswith("-"):
            continue
        match = REQ_RE.match(line)
        if not match:
            continue
        name, version = match.groups()
        _add_component(
            result,
            ParsedComponent(
                "pypi",
                name,
                version or "",
                "runtime",
                source_path,
                dependency_type="direct",
                evidence_level="manifest",
                evidence_line=line_no,
                evidence_text=line,
                detected_by="manifest",
                confidence_score=0.76,
            ),
        )


def _parse_go_mod(path: Path, root: Path, result: ParseResult) -> None:
    source_path = _relative(path, root)
    in_block = False
    for line_no, raw_line in enumerate(path.read_text(encoding="utf-8", errors="ignore").splitlines(), start=1):
        line = raw_line.strip()
        if line.startswith("require ("):
            in_block = True
            continue
        if in_block and line == ")":
            in_block = False
            continue
        if line.startswith("require "):
            line = line.removeprefix("require ").strip()
        elif not in_block:
            continue
        parts = line.split()
        if len(parts) >= 2:
            _add_component(
                result,
                ParsedComponent(
                    "go",
                    parts[0],
                    parts[1],
                    "runtime",
                    source_path,
                    dependency_type="direct",
                    evidence_level="manifest",
                    evidence_line=line_no,
                    evidence_text=line,
                    detected_by="manifest",
                    confidence_score=0.78,
                ),
            )


def _xml_text(element: ET.Element, name: str) -> str:
    child = element.find(name)
    if child is None:
        child = element.find(f"{{*}}{name}")
    return (child.text or "").strip() if child is not None else ""


def _parse_pom(path: Path, root: Path, result: ParseResult) -> None:
    source_path = _relative(path, root)
    tree = ET.parse(path)
    for dep in tree.findall(".//dependency") + tree.findall(".//{*}dependency"):
        group_id = _xml_text(dep, "groupId")
        artifact_id = _xml_text(dep, "artifactId")
        if not artifact_id:
            continue
        version = _xml_text(dep, "version")
        scope = _xml_text(dep, "scope") or "runtime"
        name = f"{group_id}:{artifact_id}" if group_id else artifact_id
        line, text = _line_evidence(path, artifact_id)
        _add_component(
            result,
            ParsedComponent(
                "maven",
                name,
                version,
                scope,
                source_path,
                group_id=group_id,
                artifact_id=artifact_id,
                dependency_type="direct",
                evidence_level="manifest",
                evidence_line=line,
                evidence_text=text,
                detected_by="manifest",
                confidence_score=0.8,
            ),
        )


FROM_RE = re.compile(r"^\s*FROM\s+([^\s]+)", re.IGNORECASE)


def _parse_dockerfile(path: Path, root: Path, result: ParseResult) -> None:
    source_path = _relative(path, root)
    for line_no, raw_line in enumerate(path.read_text(encoding="utf-8", errors="ignore").splitlines(), start=1):
        line = raw_line.strip()
        match = FROM_RE.match(line)
        if not match:
            continue
        image = match.group(1).split("@", 1)[0]
        if ":" in image:
            name, version = image.rsplit(":", 1)
        else:
            name, version = image, "latest"
        _add_component(
            result,
            ParsedComponent(
                "docker",
                name,
                version,
                "base-image",
                source_path,
                dependency_type="base_image",
                evidence_level="manifest",
                evidence_line=line_no,
                evidence_text=line,
                detected_by="dockerfile",
                confidence_score=0.9,
            ),
        )


def parse_source_dependencies(root: Path) -> ParseResult:
    result = ParseResult()
    handlers = {
        "package-lock.json": _parse_package_lock,
        "package.json": _parse_package_json,
        "requirements.txt": _parse_requirements,
        "go.mod": _parse_go_mod,
        "pom.xml": _parse_pom,
        "dockerfile": _parse_dockerfile,
    }
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        handler = handlers.get(path.name.lower())
        if not handler:
            continue
        try:
            handler(path, root, result)
            result.logs.append(f"已解析 {path.name}: {_relative(path, root)}")
        except Exception as exc:  # pragma: no cover - defensive log path
            result.logs.append(f"解析失败 {path.name}: {exc}")
    return result
