from __future__ import annotations

import fcntl
import os
import tempfile
import time
import xml.etree.ElementTree as ET
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


class DependencyCheckLockTimeout(RuntimeError):
    pass


@contextmanager
def dependency_check_lock(data_dir: Path, *, exclusive: bool, timeout: int) -> Iterator[None]:
    data_dir.mkdir(parents=True, exist_ok=True)
    lock_path = data_dir / ".cache.lock"
    with lock_path.open("a+") as handle:
        mode = fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH
        deadline = time.monotonic() + max(0, timeout)
        while True:
            try:
                fcntl.flock(handle.fileno(), mode | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise DependencyCheckLockTimeout("Dependency-Check 缓存锁等待超时")
                time.sleep(0.1)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


@contextmanager
def nvd_property_file(api_key: str) -> Iterator[str]:
    if not api_key:
        yield ""
        return

    fd, name = tempfile.mkstemp(prefix="dependency-check-", suffix=".properties")
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(f"nvd.api.key={api_key}\n")
        yield name
    finally:
        Path(name).unlink(missing_ok=True)


def dependency_check_cache_initialized(data_dir: Path) -> bool:
    if not data_dir.exists():
        return False
    return any(
        path.is_file() and path.name not in {".cache.lock", "cache-state.json"}
        for path in data_dir.rglob("*")
    )


def validate_suppression_file(path: Path) -> None:
    if not path.is_file():
        raise ValueError(f"Dependency-Check suppression 文件不存在: {path}")
    try:
        root = ET.parse(path).getroot()
    except ET.ParseError as exc:
        raise ValueError(f"Dependency-Check suppression XML 无效: {exc}") from exc
    if not root.tag.endswith("suppressions"):
        raise ValueError("Dependency-Check suppression 根节点必须为 suppressions")
