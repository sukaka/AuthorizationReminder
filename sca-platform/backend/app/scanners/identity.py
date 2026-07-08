from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Iterable
from typing import TypeVar
from urllib.parse import unquote


T = TypeVar("T")


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


def group_by_shared_keys(rows: list[T], key_factory: Callable[[T], Iterable[str]]) -> list[list[T]]:
    parents = list(range(len(rows)))

    def find(index: int) -> int:
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    def union(left: int, right: int) -> None:
        left_root = find(left)
        right_root = find(right)
        if left_root != right_root:
            parents[right_root] = left_root

    key_owners: dict[str, int] = {}
    for index, row in enumerate(rows):
        for key in set(key_factory(row)):
            owner = key_owners.setdefault(key, index)
            union(index, owner)

    grouped: dict[int, list[T]] = defaultdict(list)
    for index, row in enumerate(rows):
        grouped[find(index)].append(row)
    return list(grouped.values())
