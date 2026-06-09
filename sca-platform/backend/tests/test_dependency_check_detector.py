from __future__ import annotations

import os
import stat
from dataclasses import FrozenInstanceError
from pathlib import Path

import pytest

from app.scanners.java_detector import JavaDetectionResult, detect_java_project


@pytest.mark.parametrize(
    ("file_name", "reason"),
    [
        ("APP.JAR", "jar"),
        ("site.WAR", "war"),
        ("bundle.EAR", "ear"),
        ("pom.xml", "maven"),
        ("build.gradle", "gradle"),
        ("build.gradle.kts", "gradle"),
    ],
)
def test_detects_each_java_evidence_marker(tmp_path, file_name, reason):
    (tmp_path / file_name).write_bytes(b"")

    result = detect_java_project(tmp_path)

    assert result.enabled is True
    assert result.reasons == [reason]
    assert result.matched_paths == [file_name]


def test_detects_maven_and_jar_evidence_in_stable_order(tmp_path):
    (tmp_path / "lib").mkdir()
    (tmp_path / "pom.xml").write_text("<project />", encoding="utf-8")
    (tmp_path / "lib" / "demo.jar").write_bytes(b"")

    result = detect_java_project(tmp_path)

    assert result.enabled is True
    assert result.reasons == ["jar", "maven"]
    assert result.matched_paths == ["lib/demo.jar", "pom.xml"]


def test_non_java_project_is_disabled(tmp_path):
    (tmp_path / "package.json").write_text("{}", encoding="utf-8")

    result = detect_java_project(tmp_path)

    assert result == JavaDetectionResult(enabled=False, reasons=[], matched_paths=[])


def test_ignores_symlink_to_jar_outside_root(tmp_path):
    root = tmp_path / "project"
    root.mkdir()
    outside_jar = tmp_path / "outside.jar"
    outside_jar.write_bytes(b"")
    (root / "outside.jar").symlink_to(outside_jar)

    result = detect_java_project(root)

    assert result == JavaDetectionResult(enabled=False, reasons=[], matched_paths=[])


def test_limits_number_of_matches(tmp_path):
    for index in range(5):
        (tmp_path / f"demo-{index}.jar").write_bytes(b"")

    result = detect_java_project(tmp_path, max_matches=2)

    assert result.enabled is True
    assert result.reasons == ["jar"]
    assert result.matched_paths == ["demo-0.jar", "demo-1.jar"]


def test_max_depth_excludes_deeper_files(tmp_path):
    nested = tmp_path / "nested"
    nested.mkdir()
    (nested / "demo.jar").write_bytes(b"")

    result = detect_java_project(tmp_path, max_depth=1)

    assert result == JavaDetectionResult(enabled=False, reasons=[], matched_paths=[])


def test_max_files_stops_before_later_files(tmp_path):
    (tmp_path / "a.txt").write_text("", encoding="utf-8")
    (tmp_path / "b.jar").write_bytes(b"")

    result = detect_java_project(tmp_path, max_files=1)

    assert result == JavaDetectionResult(enabled=False, reasons=[], matched_paths=[])


def test_directories_and_symlinks_consume_file_budget(monkeypatch, tmp_path):
    class FakeEntry:
        def __init__(self, name, mode):
            self.name = name
            self.path = str(tmp_path / name)
            self.mode = mode

        def stat(self, *, follow_symlinks=True):
            assert follow_symlinks is False
            return os.stat_result((self.mode, 0, 0, 0, 0, 0, 0, 0, 0, 0))

    class FakeScandir:
        def __init__(self):
            self.entries = iter(
                [
                    FakeEntry("a-directory", stat.S_IFDIR),
                    FakeEntry("b-link", stat.S_IFLNK),
                    FakeEntry("z.jar", stat.S_IFREG),
                ]
            )

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def __iter__(self):
            return self

        def __next__(self):
            return next(self.entries)

    monkeypatch.setattr(os, "scandir", lambda _path: FakeScandir())

    result = detect_java_project(tmp_path, max_files=2)

    assert result == JavaDetectionResult(enabled=False, reasons=[], matched_paths=[])


def test_scandir_does_not_read_past_file_budget(monkeypatch, tmp_path):
    class FakeEntry:
        name = "a.txt"
        path = str(tmp_path / name)

        def stat(self, *, follow_symlinks=True):
            assert follow_symlinks is False
            return os.stat_result((stat.S_IFREG, 0, 0, 0, 0, 0, 0, 0, 0, 0))

    class LazyScandir:
        reads = 0
        closed = False

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            self.closed = True

        def __iter__(self):
            return self

        def __next__(self):
            self.reads += 1
            if self.reads == 1:
                return FakeEntry()
            raise AssertionError("scandir read past max_files")

    scanner = LazyScandir()

    def fake_scandir(path):
        assert Path(path) == tmp_path
        return scanner

    monkeypatch.setattr(os, "scandir", fake_scandir)

    result = detect_java_project(tmp_path, max_files=1)

    assert result == JavaDetectionResult(enabled=False, reasons=[], matched_paths=[])
    assert scanner.reads == 1
    assert scanner.closed is True


def test_detection_result_is_frozen():
    result = JavaDetectionResult(enabled=False, reasons=[], matched_paths=[])

    with pytest.raises(FrozenInstanceError):
        result.enabled = True
