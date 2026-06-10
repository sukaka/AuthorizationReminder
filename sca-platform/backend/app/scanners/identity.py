from __future__ import annotations

from urllib.parse import unquote


def gav_from_purl(purl: str) -> str:
    prefix = "pkg:maven/"
    if not purl.startswith(prefix):
        return ""
    path_version = purl[len(prefix) :].split("?", 1)[0].split("#", 1)[0]
    path, separator, version = path_version.rpartition("@")
    parts = [unquote(item) for item in path.split("/") if item]
    if not separator or len(parts) < 2:
        return ""
    return f"{'.'.join(parts[:-1])}:{parts[-1]}:{unquote(version)}"


def stable_component_keys(
    *,
    sha1: str = "",
    gav: str = "",
    purl: str = "",
    ecosystem: str = "",
    name: str = "",
    version: str = "",
) -> list[str]:
    keys: list[str] = []
    if sha1:
        keys.append(f"sha1:{sha1.lower()}")
    if gav:
        keys.append(f"gav:{gav.lower()}")
    if purl:
        keys.append(f"purl:{purl.lower()}")
    if ecosystem and name and version:
        keys.append(f"package:{ecosystem.lower()}:{name.lower()}@{version}")
    return keys
