from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class ParsedComponent:
    ecosystem: str
    name: str
    version: str = ""
    scope: str = "runtime"
    source_path: str = ""

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


def _relative(path: Path, root: Path) -> str:
    try:
        return str(path.relative_to(root))
    except ValueError:
        return str(path)


def _add_component(result: ParseResult, component: ParsedComponent) -> None:
    if component.key not in {item.key for item in result.components}:
        result.components.append(component)
    result.dependencies.append(ParsedDependency(child_key=component.key))


def _parse_package_json(path: Path, root: Path, result: ParseResult) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    source_path = _relative(path, root)
    groups = {
        "dependencies": "runtime",
        "devDependencies": "dev",
        "peerDependencies": "peer",
        "optionalDependencies": "optional",
    }
    for group, scope in groups.items():
        deps = data.get(group) or {}
        if not isinstance(deps, dict):
            continue
        for name, version in deps.items():
            _add_component(result, ParsedComponent("npm", str(name), str(version), scope, source_path))


REQ_RE = re.compile(r"^\s*([A-Za-z0-9_.-]+)\s*(?:==|>=|<=|~=|>|<|=)?\s*([^;#\s]+)?")


def _parse_requirements(path: Path, root: Path, result: ParseResult) -> None:
    source_path = _relative(path, root)
    for raw_line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or line.startswith("-"):
            continue
        match = REQ_RE.match(line)
        if not match:
            continue
        name, version = match.groups()
        _add_component(result, ParsedComponent("pypi", name, version or "", "runtime", source_path))


def _parse_go_mod(path: Path, root: Path, result: ParseResult) -> None:
    source_path = _relative(path, root)
    in_block = False
    for raw_line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
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
            _add_component(result, ParsedComponent("go", parts[0], parts[1], "runtime", source_path))


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
        _add_component(result, ParsedComponent("maven", name, version, scope, source_path))


FROM_RE = re.compile(r"^\s*FROM\s+([^\s]+)", re.IGNORECASE)


def _parse_dockerfile(path: Path, root: Path, result: ParseResult) -> None:
    source_path = _relative(path, root)
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        match = FROM_RE.match(line)
        if not match:
            continue
        image = match.group(1).split("@", 1)[0]
        if ":" in image:
            name, version = image.rsplit(":", 1)
        else:
            name, version = image, "latest"
        _add_component(result, ParsedComponent("docker", name, version, "base-image", source_path))


def parse_source_dependencies(root: Path) -> ParseResult:
    result = ParseResult()
    handlers = {
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
