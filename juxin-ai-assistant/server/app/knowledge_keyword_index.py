from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import shutil
from typing import Iterable

from .config import Settings

try:
    import tantivy
except ImportError:  # pragma: no cover - optional in minimal test environments
    tantivy = None


@dataclass(frozen=True)
class KeywordSearchHit:
    chunk_id: str
    score: float


@dataclass(frozen=True)
class KeywordSearchResult:
    available: bool
    hits: tuple[KeywordSearchHit, ...] = ()


class TantivyKnowledgeIndex:
    def __init__(self, *, path: str, enabled: bool) -> None:
        self.path = Path(path)
        self.enabled = bool(enabled and tantivy is not None)

    @classmethod
    def from_settings(cls, settings: Settings) -> "TantivyKnowledgeIndex":
        return cls(
            path=settings.knowledge_keyword_index_dir,
            enabled=settings.knowledge_keyword_index_enabled,
        )

    @staticmethod
    def schema():
        if tantivy is None:
            raise RuntimeError("tantivy is not installed")
        builder = tantivy.SchemaBuilder()
        builder.add_text_field("chunk_id", stored=True, tokenizer_name="raw")
        builder.add_text_field("file_uuid", tokenizer_name="raw")
        builder.add_text_field("terms")
        return builder.build()

    def rebuild(self, rows: Iterable[tuple[str, str, str]]) -> int:
        if not self.enabled or tantivy is None:
            return 0
        if self.path.exists():
            shutil.rmtree(self.path)
        self.path.mkdir(parents=True, exist_ok=True)
        index = tantivy.Index(self.schema(), path=str(self.path), reuse=False)
        writer = index.writer(heap_size=128_000_000)
        count = 0
        for chunk_id, file_uuid, terms in rows:
            writer.add_document(tantivy.Document(
                chunk_id=[chunk_id],
                file_uuid=[file_uuid],
                terms=[terms],
            ))
            count += 1
        writer.commit()
        index.reload()
        del writer
        del index
        for root, directories, files in os.walk(self.path):
            os.chmod(root, 0o755)
            for directory in directories:
                try:
                    os.chmod(Path(root) / directory, 0o755)
                except FileNotFoundError:
                    pass
            for file_name in files:
                try:
                    os.chmod(Path(root) / file_name, 0o644)
                except FileNotFoundError:
                    pass
        return count

    def replace_file(self, file_uuid: str, rows: Iterable[tuple[str, str]]) -> int:
        if not self.enabled or tantivy is None or not self.path.exists():
            return 0
        try:
            index = tantivy.Index.open(str(self.path))
            writer = index.writer(heap_size=64_000_000)
            writer.delete_documents("file_uuid", file_uuid)
            count = 0
            for chunk_id, terms in rows:
                writer.add_document(tantivy.Document(
                    chunk_id=[chunk_id],
                    file_uuid=[file_uuid],
                    terms=[terms],
                ))
                count += 1
            writer.commit()
            index.reload()
            return count
        except Exception:
            return 0

    def delete_file(self, file_uuid: str) -> None:
        self.replace_file(file_uuid, ())

    def search(self, terms: list[str], *, limit: int) -> KeywordSearchResult:
        if not self.enabled or tantivy is None or not self.path.exists() or not terms:
            return KeywordSearchResult(available=False)
        try:
            index = tantivy.Index.open(str(self.path))
            index.reload()
            searcher = index.searcher()
            query_text = " OR ".join(f'"{term.replace(chr(34), "")}"' for term in terms if term)
            query = index.parse_query(query_text, ["terms"])
            result = searcher.search(query, limit)
            hits: list[KeywordSearchHit] = []
            for score, address in result.hits:
                document = searcher.doc(address).to_dict()
                values = document.get("chunk_id") or []
                if values:
                    hits.append(KeywordSearchHit(str(values[0]), float(score)))
            return KeywordSearchResult(available=True, hits=tuple(hits))
        except Exception:
            return KeywordSearchResult(available=False)
