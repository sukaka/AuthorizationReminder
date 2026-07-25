from pathlib import Path
from zipfile import ZipFile

import pytest

from scripts.run_dashi_ppt_acceptance import _extract_html_package, _inspect_pptx


def test_extract_html_package_preserves_complete_offline_project(tmp_path: Path):
    package_path = tmp_path / "presentation-html.zip"
    with ZipFile(package_path, "w") as package:
        package.writestr("index.html", "<main>完整演示</main>")
        package.writestr("assets/imported-theme-runtime.js", "window.runtime = true")
        package.writestr("assets/fonts/deck.woff2", b"font")

    destination = tmp_path / "offline"
    names = _extract_html_package(package_path, destination)

    assert set(names) == {
        "index.html",
        "assets/imported-theme-runtime.js",
        "assets/fonts/deck.woff2",
    }
    assert (destination / "index.html").read_text(encoding="utf-8") == "<main>完整演示</main>"
    assert (destination / "assets" / "imported-theme-runtime.js").is_file()
    assert (destination / "assets" / "fonts" / "deck.woff2").is_file()


def test_extract_html_package_rejects_path_traversal(tmp_path: Path):
    package_path = tmp_path / "unsafe.zip"
    with ZipFile(package_path, "w") as package:
        package.writestr("index.html", "ok")
        package.writestr("../escaped.txt", "must not escape")

    with pytest.raises(RuntimeError, match="不安全路径"):
        _extract_html_package(package_path, tmp_path / "offline")

    assert not (tmp_path / "escaped.txt").exists()


def test_inspect_pptx_requires_open_xml_core_and_counts_slides(tmp_path: Path):
    pptx_path = tmp_path / "presentation.pptx"
    with ZipFile(pptx_path, "w") as package:
        package.writestr("[Content_Types].xml", "<Types />")
        package.writestr("ppt/presentation.xml", "<presentation />")
        package.writestr("ppt/slides/slide1.xml", "<slide />")
        package.writestr("ppt/slides/slide2.xml", "<slide />")
        package.writestr("ppt/slides/_rels/slide1.xml.rels", "<Relationships />")

    assert _inspect_pptx(pptx_path) == 2


def test_inspect_pptx_rejects_non_pptx_zip(tmp_path: Path):
    pptx_path = tmp_path / "fake.pptx"
    with ZipFile(pptx_path, "w") as package:
        package.writestr("ppt/slides/slide1.xml", "<slide />")

    with pytest.raises(RuntimeError, match="缺少 Open XML 核心文件"):
        _inspect_pptx(pptx_path)
