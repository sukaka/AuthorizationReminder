from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass, field
from hashlib import sha1, sha256
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
    scan_mode: str = "manifest_scan"
    detection_method: str = "manifest"
    evidence_type: str = "manifest"
    confidence_level: str = "Medium"
    need_manual_confirm: bool = False
    version_detected: bool = True
    need_manual_version_confirm: bool = False
    declared_version: str = ""
    resolved_version: str = ""
    version_lock_status: str = "已锁定版本"
    version_risk_type: str = ""
    risk_explanation: str = ""
    fix_recommendation: str = ""
    sha1: str = ""
    sha256: str = ""
    file_size: int = 0
    file_path: str = ""
    file_name: str = ""

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
    scan_mode: str = "manifest_scan"
    has_standard_manifest: bool = False
    fallback_enabled: bool = False
    fallback_methods: list[str] = field(default_factory=list)
    suggestions: list[str] = field(default_factory=list)


SUGGESTED_MATERIALS = [
    "pom.xml / build.gradle",
    "package.json / package-lock.json / yarn.lock / pnpm-lock.yaml",
    "requirements.txt / poetry.lock / Pipfile.lock",
    "go.mod / go.sum",
    "composer.lock",
    "Gemfile.lock",
    "SBOM 文件",
    "Docker 镜像 tar",
    "war / jar 包",
    "运行目录",
    "pip freeze 输出",
    "npm list 输出",
    "mvn dependency:tree 输出",
]

STANDARD_MANIFESTS = {
    "package.json",
    "requirements.txt",
    "go.mod",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "pyproject.toml",
    "pipfile",
    "gemfile",
    "composer.json",
    "cargo.toml",
}

LOCK_FILES = {
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "poetry.lock",
    "pipfile.lock",
    "go.sum",
    "gradle.lockfile",
    "gemfile.lock",
    "composer.lock",
    "cargo.lock",
    "packages.lock.json",
}

PYTHON_IMPORT_PACKAGE_MAP = {
    "PIL": "Pillow",
    "cv2": "opencv-python",
    "yaml": "PyYAML",
    "sklearn": "scikit-learn",
}


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


def _confidence_level(score: float, version: str = "") -> str:
    if version == "unknown":
        return "Review"
    if score >= 0.88:
        return "High"
    if score >= 0.7:
        return "Medium"
    return "Low"


def _classify_version(declared: str, resolved: str = "") -> dict[str, object]:
    raw = (declared or "").strip()
    actual = (resolved or "").strip()
    if actual and actual != raw:
        if not raw:
            return {
                "version": actual,
                "status": "已锁定版本",
                "risk": "",
                "detected": True,
                "manual": False,
                "explanation": "已从 lock 文件或构建产物解析到实际版本。",
            }
        return {
            "version": actual,
            "status": "基于实际版本匹配",
            "risk": "版本范围风险" if _is_version_range(raw) else "未锁定版本风险",
            "detected": True,
            "manual": False,
            "explanation": "该依赖声明未锁定或使用版本范围，当前漏洞匹配基于解析到的实际版本。不同环境、不同时间或不同构建结果可能导致实际版本不同。",
        }
    if not raw:
        return {
            "version": "unknown",
            "status": "未锁定版本风险",
            "risk": "版本缺失风险",
            "detected": False,
            "manual": True,
            "explanation": "版本缺失，漏洞结果可能不准确。",
        }
    if _is_dynamic_version(raw):
        return {
            "version": raw,
            "status": "动态版本风险",
            "risk": "动态版本风险",
            "detected": True,
            "manual": True,
            "explanation": "依赖使用动态版本或 latest，构建结果不可复现。",
        }
    if _is_version_range(raw):
        return {
            "version": raw,
            "status": "版本范围风险",
            "risk": "版本范围风险",
            "detected": True,
            "manual": True,
            "explanation": "依赖使用版本范围，需结合 lock 文件或实际安装版本确认。",
        }
    return {
        "version": raw,
        "status": "已锁定版本",
        "risk": "",
        "detected": True,
        "manual": False,
        "explanation": "依赖声明了明确、唯一、可复现的版本号。",
    }


def _is_version_range(version: str) -> bool:
    value = version.strip()
    return bool(
        value.startswith(("^", "~", ">", "<", ">=", "<=", "~=", "[", "("))
        or "," in value
        or "*" in value
        or value.endswith(".+")
        or " - " in value
    )


def _is_dynamic_version(version: str) -> bool:
    value = version.strip().lower()
    return value in {"latest", "latest.release", "latest.integration", "snapshot"} or value.endswith("-snapshot")


def _file_fingerprint(path: Path, root: Path) -> dict[str, object]:
    data = path.read_bytes()
    return {
        "sha1": sha1(data).hexdigest(),
        "sha256": sha256(data).hexdigest(),
        "file_size": len(data),
        "file_path": _relative(path, root),
        "file_name": path.name,
    }


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
    component.declared_version = component.declared_version or component.version
    component.resolved_version = component.resolved_version or (
        component.version if component.version and not _is_version_range(component.version) and not _is_dynamic_version(component.version) else ""
    )
    version_state = _classify_version(component.declared_version, component.resolved_version)
    component.version = str(version_state["version"])
    component.version_normalized = component.version_normalized or _normalize_version(component.version)
    component.version_lock_status = str(version_state["status"])
    component.version_risk_type = str(version_state["risk"])
    component.version_detected = bool(version_state["detected"])
    component.need_manual_version_confirm = bool(version_state["manual"])
    component.risk_explanation = component.risk_explanation or str(version_state["explanation"])
    component.fix_recommendation = component.fix_recommendation or (
        "建议补充精确版本号，或使用对应生态的 lock 文件 / 依赖锁定机制，以提高漏洞扫描准确性和构建可复现性。"
        if component.need_manual_version_confirm
        else ""
    )
    component.need_manual_confirm = component.need_manual_confirm or component.need_manual_version_confirm or component.version == "unknown"
    component.confidence_level = component.confidence_level or _confidence_level(component.confidence_score, component.version)
    if component.ecosystem == "pypi":
        component.normalized_name = component.normalized_name or _normalize_pypi_name(component.name)
    else:
        component.normalized_name = component.normalized_name or component.name.lower()

    has_usable_version = bool(component.version_normalized and component.version_normalized != "unknown")
    if component.ecosystem == "maven":
        group_id, _, artifact_id = component.name.partition(":")
        component.group_id = component.group_id or group_id
        component.artifact_id = component.artifact_id or artifact_id
        if component.group_id and component.artifact_id and has_usable_version:
            component.purl = component.purl or f"pkg:maven/{component.group_id}/{component.artifact_id}@{component.version_normalized}"
    elif component.ecosystem == "npm" and has_usable_version:
        component.purl = component.purl or f"pkg:npm/{quote(component.normalized_name, safe='/')}@{component.version_normalized}"
    elif component.ecosystem == "pypi" and has_usable_version:
        component.purl = component.purl or f"pkg:pypi/{component.normalized_name}@{component.version_normalized}"
    elif component.ecosystem == "go" and has_usable_version:
        component.purl = component.purl or f"pkg:golang/{component.name}@{component.version_normalized}"
    elif component.ecosystem == "docker" and has_usable_version:
        component.purl = component.purl or f"pkg:docker/{component.name}@{component.version_normalized}"
    return component


def _add_component(result: ParseResult, component: ParsedComponent) -> None:
    component = _normalize_component(component)
    component.confidence_level = _confidence_level(component.confidence_score, component.version)
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
    if "node_modules/" in source_path.replace("\\", "/"):
        return
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
                declared_version=manifest_version,
                resolved_version=version,
            ),
        )


REQ_RE = re.compile(r"^\s*([A-Za-z0-9_.-]+)\s*([=!<>~]{1,2})?\s*([^;#\s]+)?")


def _parse_requirements(path: Path, root: Path, result: ParseResult) -> None:
    source_path = _relative(path, root)
    for line_no, raw_line in enumerate(path.read_text(encoding="utf-8", errors="ignore").splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#") or line.startswith("-"):
            continue
        match = REQ_RE.match(line)
        if not match:
            continue
        name, operator, version = match.groups()
        if operator == "==" and version:
            declared = version
            actual_version = version
            resolved_version = version
        else:
            declared = f"{operator or ''}{version or ''}".strip()
            actual_version = declared
            resolved_version = ""
        _add_component(
            result,
            ParsedComponent(
                "pypi",
                name,
                actual_version,
                "runtime",
                source_path,
                dependency_type="direct",
                evidence_level="manifest",
                evidence_line=line_no,
                evidence_text=line,
                detected_by="manifest",
                confidence_score=0.84 if operator == "==" and version else 0.62,
                declared_version=declared,
                resolved_version=resolved_version,
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
                    declared_version=parts[1],
                    resolved_version=parts[1],
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
    managed_versions: dict[tuple[str, str], str] = {}
    for managed in tree.findall(".//dependencyManagement//dependency") + tree.findall(".//{*}dependencyManagement//{*}dependency"):
        managed_group = _xml_text(managed, "groupId")
        managed_artifact = _xml_text(managed, "artifactId")
        managed_version = _xml_text(managed, "version")
        if managed_group and managed_artifact and managed_version:
            managed_versions[(managed_group, managed_artifact)] = managed_version
    for dep in tree.findall(".//dependency") + tree.findall(".//{*}dependency"):
        group_id = _xml_text(dep, "groupId")
        artifact_id = _xml_text(dep, "artifactId")
        if not artifact_id:
            continue
        version = _xml_text(dep, "version")
        resolved_version = version or managed_versions.get((group_id, artifact_id), "")
        scope = _xml_text(dep, "scope") or "runtime"
        name = f"{group_id}:{artifact_id}" if group_id else artifact_id
        line, text = _line_evidence(path, artifact_id)
        _add_component(
            result,
            ParsedComponent(
                "maven",
                name,
                resolved_version or version,
                scope,
                source_path,
                group_id=group_id,
                artifact_id=artifact_id,
                dependency_type="direct",
                evidence_level="manifest",
                evidence_line=line,
                evidence_text=text,
                detected_by="manifest",
                confidence_score=0.84 if resolved_version else 0.58,
                declared_version=version,
                resolved_version=resolved_version,
            ),
        )


GRADLE_QUOTED_RE = re.compile(r"^\s*(?:implementation|api|compileOnly|runtimeOnly|testImplementation)\s+['\"]([^:'\"]+):([^:'\"]+):([^'\"]+)['\"]")
GRADLE_MAP_RE = re.compile(
    r"^\s*(?:implementation|api|compileOnly|runtimeOnly|testImplementation)\s+group:\s*['\"]([^'\"]+)['\"],\s*name:\s*['\"]([^'\"]+)['\"],\s*version:\s*['\"]([^'\"]+)['\"]"
)


def _parse_gradle(path: Path, root: Path, result: ParseResult) -> None:
    source_path = _relative(path, root)
    for line_no, raw_line in enumerate(path.read_text(encoding="utf-8", errors="ignore").splitlines(), start=1):
        line = raw_line.strip()
        match = GRADLE_QUOTED_RE.match(line) or GRADLE_MAP_RE.match(line)
        if not match:
            continue
        group_id, artifact_id, version = match.groups()
        scope = "test" if "test" in line.lower() else "runtime"
        _add_component(
            result,
            ParsedComponent(
                "maven",
                f"{group_id}:{artifact_id}",
                version,
                scope,
                source_path,
                group_id=group_id,
                artifact_id=artifact_id,
                dependency_type="direct",
                evidence_level="manifest",
                evidence_file=source_path,
                evidence_line=line_no,
                evidence_text=line,
                detected_by="manifest",
                confidence_score=0.7,
                detection_method="gradle_manifest",
                declared_version=version,
                resolved_version="" if _is_version_range(version) or _is_dynamic_version(version) else version,
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
                declared_version=version,
                resolved_version="" if version == "latest" else version,
            ),
        )


def _parse_properties(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


JAR_NAME_RE = re.compile(r"(?P<name>.+)-(?P<version>v?\d[\w.+-]*(?:\.\w[\w.+-]*)*)\.(?:jar|war|ear)$", re.IGNORECASE)


def _component_from_java_archive(path: Path, root: Path, result: ParseResult, nested_name: str = "") -> None:
    source_path = nested_name or _relative(path, root)
    fingerprint = _file_fingerprint(path, root) if not nested_name else {}
    try:
        with zipfile.ZipFile(path) as archive:
            for name in archive.namelist():
                lower = name.lower()
                if lower.endswith("pom.properties") and "/meta-inf/maven/" in f"/{lower}":
                    props = _parse_properties(archive.read(name).decode("utf-8", errors="ignore"))
                    group_id = props.get("groupId", "")
                    artifact_id = props.get("artifactId", "")
                    version = props.get("version", "")
                    if group_id and artifact_id:
                        _add_component(
                            result,
                            ParsedComponent(
                                "maven",
                                f"{group_id}:{artifact_id}",
                                version,
                                "runtime",
                                source_path,
                                group_id=group_id,
                                artifact_id=artifact_id,
                                evidence_level="metadata",
                                evidence_file=source_path,
                                evidence_text=name,
                                detected_by="fallback",
                                confidence_score=0.94,
                                scan_mode="binary_scan",
                                detection_method="jar_pom_properties",
                                evidence_type="pom.properties",
                                confidence_level="High",
                                declared_version=version,
                                resolved_version=version,
                                **fingerprint,
                            ),
                        )
                        return
            if path.suffix.lower() in {".war", ".ear"}:
                for name in archive.namelist():
                    if name.lower().endswith(".jar") and ("web-inf/lib/" in name.lower() or "/lib/" in name.lower()):
                        _component_from_archive_filename(name, root, result, source_path=f"{source_path}!/{name}", score=0.7)
    except zipfile.BadZipFile:
        result.logs.append(f"Java 归档无法解压: {source_path}")
    _component_from_archive_filename(path.name, root, result, source_path=source_path, score=0.68, fingerprint=fingerprint)


def _component_from_archive_filename(
    filename: str,
    root: Path,
    result: ParseResult,
    source_path: str,
    score: float = 0.62,
    fingerprint: dict[str, object] | None = None,
) -> None:
    match = JAR_NAME_RE.match(Path(filename).name)
    if not match:
        return
    name = match.group("name")
    version = match.group("version")
    _add_component(
        result,
        ParsedComponent(
            "maven",
            name,
            version,
            "runtime",
            source_path,
            artifact_id=name,
            evidence_level="filename",
            evidence_file=source_path,
            evidence_text=Path(filename).name,
            detected_by="fallback",
            confidence_score=score,
            scan_mode="binary_scan",
            detection_method="jar_filename",
            evidence_type="filename",
            confidence_level=_confidence_level(score, version),
            declared_version=version,
            resolved_version=version,
            **(fingerprint or {}),
        ),
    )


def _parse_node_modules_package(path: Path, root: Path, result: ParseResult) -> None:
    rel = _relative(path, root)
    if "node_modules/" not in rel.replace("\\", "/"):
        return
    data = json.loads(path.read_text(encoding="utf-8"))
    name = str(data.get("name") or "")
    version = str(data.get("version") or "")
    if not name:
        return
    _add_component(
        result,
        ParsedComponent(
            "npm",
            name,
            version,
            "runtime",
            rel,
            dependency_type="indirect",
            evidence_level="metadata",
            evidence_file=rel,
            evidence_text=f'"name": "{name}", "version": "{version}"',
            detected_by="fallback",
            confidence_score=0.76,
            scan_mode="directory_fingerprint_scan",
            detection_method="node_modules_package_json",
            evidence_type="package.json",
            declared_version=version,
            resolved_version=version,
        ),
    )


def _parse_python_metadata(path: Path, root: Path, result: ParseResult) -> None:
    rel = _relative(path, root)
    metadata: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        if ": " not in raw_line:
            continue
        key, value = raw_line.split(": ", 1)
        if key in {"Name", "Version"}:
            metadata[key] = value.strip()
    if not metadata.get("Name"):
        return
    version = metadata.get("Version", "")
    _add_component(
        result,
        ParsedComponent(
            "pypi",
            metadata["Name"],
            version,
            "runtime",
            rel,
            dependency_type="indirect",
            evidence_level="metadata",
            evidence_file=rel,
            evidence_text=f"Name: {metadata['Name']} Version: {version}",
            detected_by="fallback",
            confidence_score=0.92 if version else 0.72,
            scan_mode="directory_fingerprint_scan",
            detection_method="python_dist_metadata",
            evidence_type="dist-info",
            declared_version=version,
            resolved_version=version,
        ),
    )


PY_IMPORT_RE = re.compile(r"^\s*(?:import\s+([A-Za-z_][\w.]*)|from\s+([A-Za-z_][\w.]*)\s+import\s+.+)")


def _parse_python_imports(path: Path, root: Path, result: ParseResult) -> None:
    rel = _relative(path, root)
    for line_no, raw_line in enumerate(path.read_text(encoding="utf-8", errors="ignore").splitlines(), start=1):
        match = PY_IMPORT_RE.match(raw_line)
        if not match:
            continue
        module = (match.group(1) or match.group(2) or "").split(".", 1)[0]
        if not module or module.startswith("_"):
            continue
        package = PYTHON_IMPORT_PACKAGE_MAP.get(module, module)
        _add_component(
            result,
            ParsedComponent(
                "pypi",
                package,
                "",
                "runtime",
                rel,
                evidence_level="source",
                evidence_file=rel,
                evidence_line=line_no,
                evidence_text=raw_line.strip(),
                detected_by="fallback",
                confidence_score=0.42 if module in PYTHON_IMPORT_PACKAGE_MAP else 0.35,
                scan_mode="source_heuristic_scan",
                detection_method="python_import",
                evidence_type="import",
                need_manual_confirm=True,
            ),
        )


def _parse_go_sum(path: Path, root: Path, result: ParseResult) -> None:
    rel = _relative(path, root)
    seen: set[tuple[str, str]] = set()
    for line_no, raw_line in enumerate(path.read_text(encoding="utf-8", errors="ignore").splitlines(), start=1):
        parts = raw_line.split()
        if len(parts) < 2 or parts[1].endswith("/go.mod"):
            continue
        key = (parts[0], parts[1])
        if key in seen:
            continue
        seen.add(key)
        _add_component(
            result,
            ParsedComponent(
                "go",
                parts[0],
                parts[1],
                "runtime",
                rel,
                dependency_type="indirect",
                evidence_level="lock",
                evidence_file=rel,
                evidence_line=line_no,
                evidence_text=raw_line.strip(),
                detected_by="lock",
                confidence_score=0.88,
                scan_mode="lockfile_scan",
                detection_method="go_sum",
                evidence_type="lock",
                declared_version=parts[1],
                resolved_version=parts[1],
            ),
        )


def _parse_composer_lock(path: Path, root: Path, result: ParseResult) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    rel = _relative(path, root)
    for section, scope in (("packages", "runtime"), ("packages-dev", "dev")):
        for package in data.get(section, []) if isinstance(data, dict) else []:
            name = str(package.get("name") or "")
            version = str(package.get("version") or "")
            if not name:
                continue
            _add_component(
                result,
                ParsedComponent(
                    "composer",
                    name,
                    version,
                    scope,
                    rel,
                    package_manager="composer",
                    evidence_level="lock",
                    evidence_file=rel,
                    evidence_text=name,
                    detected_by="lock",
                    confidence_score=0.9,
                    scan_mode="lockfile_scan",
                    detection_method="composer_lock",
                    evidence_type="lock",
                    declared_version=version,
                    resolved_version=version,
                ),
            )


def _parse_cargo_lock(path: Path, root: Path, result: ParseResult) -> None:
    rel = _relative(path, root)
    current: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8", errors="ignore").splitlines() + [""]:
        line = raw_line.strip()
        if line == "[[package]]":
            current = {}
            continue
        if not line and current.get("name"):
            name = current.get("name", "")
            version = current.get("version", "")
            _add_component(
                result,
                ParsedComponent(
                    "cargo",
                    name,
                    version,
                    "runtime",
                    rel,
                    package_manager="cargo",
                    evidence_level="lock",
                    evidence_file=rel,
                    evidence_text=name,
                    detected_by="lock",
                    confidence_score=0.9,
                    scan_mode="lockfile_scan",
                    detection_method="cargo_lock",
                    evidence_type="lock",
                    declared_version=version,
                    resolved_version=version,
                ),
            )
            current = {}
            continue
        if "=" in line:
            key, value = line.split("=", 1)
            current[key.strip()] = value.strip().strip('"')


def _parse_gemfile_lock(path: Path, root: Path, result: ParseResult) -> None:
    rel = _relative(path, root)
    gem_re = re.compile(r"^\s{4}([A-Za-z0-9_.-]+) \(([^)]+)\)")
    for line_no, raw_line in enumerate(path.read_text(encoding="utf-8", errors="ignore").splitlines(), start=1):
        match = gem_re.match(raw_line)
        if not match:
            continue
        _add_component(
            result,
            ParsedComponent(
                "gem",
                match.group(1),
                match.group(2),
                "runtime",
                rel,
                package_manager="bundler",
                evidence_level="lock",
                evidence_file=rel,
                evidence_line=line_no,
                evidence_text=raw_line.strip(),
                detected_by="lock",
                confidence_score=0.88,
                scan_mode="lockfile_scan",
                detection_method="gemfile_lock",
                evidence_type="lock",
                declared_version=match.group(2),
                resolved_version=match.group(2),
            ),
        )


def _scan_mode_for(result: ParseResult) -> str:
    modes = {item.scan_mode for item in result.components if item.scan_mode}
    if not modes:
        return "manifest_scan" if result.has_standard_manifest else "source_heuristic_scan"
    if len(modes) > 1:
        return "mixed_scan"
    return next(iter(modes))


def parse_source_dependencies(root: Path) -> ParseResult:
    result = ParseResult()
    handlers = {
        "package-lock.json": _parse_package_lock,
        "package.json": _parse_package_json,
        "requirements.txt": _parse_requirements,
        "go.mod": _parse_go_mod,
        "go.sum": _parse_go_sum,
        "pom.xml": _parse_pom,
        "build.gradle": _parse_gradle,
        "build.gradle.kts": _parse_gradle,
        "dockerfile": _parse_dockerfile,
        "composer.lock": _parse_composer_lock,
        "cargo.lock": _parse_cargo_lock,
        "gemfile.lock": _parse_gemfile_lock,
    }
    all_files = [path for path in root.rglob("*") if path.is_file()]
    result.has_standard_manifest = any(
        path.name.lower() in STANDARD_MANIFESTS and "node_modules/" not in _relative(path, root).replace("\\", "/")
        for path in all_files
    )
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
    if result.has_standard_manifest:
        result.scan_mode = _scan_mode_for(result)
        return result

    result.fallback_enabled = True
    result.suggestions = SUGGESTED_MATERIALS.copy()
    fallback_before = len(result.components)
    for path in all_files:
        lower = path.name.lower()
        try:
            if lower.endswith((".jar", ".war", ".ear")):
                _component_from_java_archive(path, root, result)
                result.fallback_methods.append("java_archive")
            elif lower == "package.json" and "node_modules" in _relative(path, root).replace("\\", "/"):
                _parse_node_modules_package(path, root, result)
                result.fallback_methods.append("node_modules")
            elif lower in {"metadata", "pkg-info"} and (".dist-info" in str(path) or ".egg-info" in str(path)):
                _parse_python_metadata(path, root, result)
                result.fallback_methods.append("python_metadata")
            elif lower.endswith(".py"):
                _parse_python_imports(path, root, result)
                result.fallback_methods.append("python_import")
        except Exception as exc:  # pragma: no cover - defensive log path
            result.logs.append(f"兜底识别失败 {_relative(path, root)}: {exc}")
    result.fallback_methods = sorted(set(result.fallback_methods))
    result.scan_mode = _scan_mode_for(result)
    if len(result.components) > fallback_before:
        result.logs.append("未发现标准依赖清单文件，系统已启用兜底识别模式")
    else:
        result.logs.append("未发现标准依赖清单文件，兜底识别未发现明确组件")
    return result
