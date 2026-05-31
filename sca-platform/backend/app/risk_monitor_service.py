from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

import httpx

from .config import Settings
from .models import Component


@dataclass(frozen=True)
class VersionInfo:
    latest_version: str = ""
    latest_source: str = ""
    raw: dict[str, Any] | None = None


VERSION_RE = re.compile(r"v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+._]?([0-9A-Za-z.-]+))?")


def _parse_version(value: str) -> tuple[int, int, int, int, str]:
    text = str(value or "").strip()
    match = VERSION_RE.search(text)
    if not match:
        return (0, 0, 0, -1, text)
    major, minor, patch, suffix = match.groups()
    stable = 1 if not suffix else 0
    return (int(major or 0), int(minor or 0), int(patch or 0), stable, suffix or "")


def compare_versions(current: str, latest: str) -> int:
    left = _parse_version(current)
    right = _parse_version(latest)
    if left == right:
        return 0
    return 1 if left > right else -1


def version_delta(current: str, latest: str) -> str:
    current_parts = _parse_version(current)
    latest_parts = _parse_version(latest)
    if compare_versions(current, latest) >= 0:
        return "none"
    if latest_parts[0] > current_parts[0]:
        return "major"
    if latest_parts[1] > current_parts[1]:
        return "minor"
    return "patch"


def _client(settings: Settings) -> httpx.Client:
    headers = {}
    if settings.github_token:
        headers["Authorization"] = f"Bearer {settings.github_token}"
    return httpx.Client(timeout=settings.vulnerability_fetch_timeout_ms / 1000, headers=headers)


def query_github_latest_release(repo: str, settings: Settings) -> VersionInfo:
    repo = repo.strip().removeprefix("https://github.com/").strip("/")
    if not repo or "/" not in repo:
        return VersionInfo()
    with _client(settings) as client:
        response = client.get(f"{settings.github_api_url.rstrip('/')}/repos/{repo}/releases/latest")
        response.raise_for_status()
    data = response.json()
    return VersionInfo(str(data.get("tag_name") or data.get("name") or ""), "github", data)


def query_maven_latest(component: Component, settings: Settings) -> VersionInfo:
    if ":" not in component.package_name:
        return VersionInfo()
    group_id, artifact_id = component.package_name.split(":", 1)
    params = {"q": f'g:"{group_id}" AND a:"{artifact_id}"', "rows": 1, "wt": "json"}
    with _client(settings) as client:
        response = client.get(settings.maven_search_url, params=params)
        response.raise_for_status()
    data = response.json()
    docs = data.get("response", {}).get("docs", [])
    if not docs:
        return VersionInfo()
    return VersionInfo(str(docs[0].get("latestVersion") or ""), "maven", docs[0])


def query_npm_latest(component: Component, settings: Settings) -> VersionInfo:
    with _client(settings) as client:
        response = client.get(f"{settings.npm_registry_url.rstrip('/')}/{component.package_name}")
        response.raise_for_status()
    data = response.json()
    return VersionInfo(str(data.get("dist-tags", {}).get("latest") or ""), "npm", data.get("dist-tags", {}))


def query_pypi_latest(component: Component, settings: Settings) -> VersionInfo:
    with _client(settings) as client:
        response = client.get(f"{settings.pypi_api_url.rstrip('/')}/{component.package_name}/json")
        response.raise_for_status()
    data = response.json()
    return VersionInfo(str(data.get("info", {}).get("version") or ""), "pypi", data.get("info", {}))


def query_go_latest(component: Component, settings: Settings) -> VersionInfo:
    with _client(settings) as client:
        response = client.get(f"{settings.go_proxy_url.rstrip('/')}/{component.package_name}/@latest")
        response.raise_for_status()
    data = response.json()
    return VersionInfo(str(data.get("Version") or ""), "go", data)


def detect_eol(component: Component, latest_version: str, settings: Settings) -> tuple[str, str]:
    if component.ecosystem == "docker" and component.package_version in {"latest", ""}:
        return "review", ""
    if latest_version and version_delta(component.package_version, latest_version) == "major":
        return "review", ""
    return "active", ""


def _latest_for_component(component: Component, settings: Settings) -> VersionInfo:
    try:
        if component.ecosystem == "npm":
            return query_npm_latest(component, settings)
        if component.ecosystem == "pypi":
            return query_pypi_latest(component, settings)
        if component.ecosystem == "maven":
            return query_maven_latest(component, settings)
        if component.ecosystem == "go":
            return query_go_latest(component, settings)
        if component.source_path.startswith("github:"):
            return query_github_latest_release(component.source_path.removeprefix("github:"), settings)
    except Exception:
        return VersionInfo()
    return VersionInfo()


def monitor_component_update(component: Component, settings: Settings) -> dict[str, Any]:
    latest = _latest_for_component(component, settings)
    update_available = bool(latest.latest_version and compare_versions(component.package_version, latest.latest_version) < 0)
    delta = version_delta(component.package_version, latest.latest_version) if latest.latest_version else "unknown"
    eol_status, eol_date = detect_eol(component, latest.latest_version, settings)
    recommendation = "当前版本暂无更新建议"
    if update_available:
        recommendation = f"建议升级到 {latest.latest_version}，更新级别：{delta}"
    if eol_status in {"eol", "review"}:
        recommendation += "；请同步确认生命周期状态"
    return {
        "component_name": component.package_name,
        "current_version": component.package_version,
        "latest_version": latest.latest_version,
        "latest_source": latest.latest_source,
        "update_available": update_available,
        "version_delta": delta,
        "eol_status": eol_status,
        "eol_date": eol_date,
        "recommendation": recommendation,
        "raw": latest.raw or {},
    }


def snapshot_risk_level(update_available: bool, delta: str, eol_status: str, vulnerability_count: int) -> str:
    if eol_status == "eol" or vulnerability_count >= 3:
        return "high"
    if delta == "major" or vulnerability_count > 0:
        return "high"
    if update_available:
        return "medium"
    return "low"


def raw_json(value: dict[str, Any]) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)
