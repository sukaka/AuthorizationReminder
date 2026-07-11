from pathlib import Path

import pytest

pytest.importorskip("tantivy")

from app.knowledge_keyword_index import TantivyKnowledgeIndex


def test_tantivy_index_rebuild_and_search(tmp_path: Path) -> None:
    index = TantivyKnowledgeIndex(path=str(tmp_path / "index"), enabled=True)
    assert index.rebuild([
        ("chunk-cli", "file-cli", "show cmi 命令行 管理员 手册"),
        ("chunk-other", "file-other", "产品 方案 简介"),
    ]) == 2

    result = index.search(["show", "cmi"], limit=10)

    assert result.available is True
    assert result.hits
    assert result.hits[0].chunk_id == "chunk-cli"

    assert index.replace_file("file-cli", [("chunk-new", "set cmi 管理口")]) == 1
    assert not index.search(["show"], limit=10).hits
    assert index.search(["set", "cmi"], limit=10).hits[0].chunk_id == "chunk-new"

    index.delete_file("file-cli")
    assert not index.search(["set"], limit=10).hits


def test_tantivy_index_is_unavailable_when_disabled(tmp_path: Path) -> None:
    index = TantivyKnowledgeIndex(path=str(tmp_path / "index"), enabled=False)
    assert index.search(["show"], limit=10).available is False
