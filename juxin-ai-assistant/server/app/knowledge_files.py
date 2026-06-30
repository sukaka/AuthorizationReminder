import hashlib
import re
import uuid as uuid_lib
import csv
from dataclasses import dataclass
from io import BytesIO, StringIO
from pathlib import Path
from zipfile import BadZipFile, ZipFile
import xml.etree.ElementTree as ET

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .attachments import _parse_docx_text
from .crypto import ContentCipher, EncryptedPayload
from .models import KnowledgeChunk, KnowledgeFile


MAX_KNOWLEDGE_FILE_BYTES = 20 * 1024 * 1024
SUPPORTED_KNOWLEDGE_SUFFIXES = {".txt", ".md", ".docx", ".pdf", ".xlsx", ".csv"}
UNSUPPORTED_KNOWLEDGE_TYPE_MESSAGE = "当前仅支持 txt、md、docx、pdf、xlsx、csv"
HEADING_PATTERN = re.compile(r"^([一二三四五六七八九十]+、|\d+[.．、])\S+")
PDF_LITERAL_PATTERN = re.compile(r"\(((?:\\.|[^\\)])*)\)\s*Tj")


@dataclass(frozen=True)
class ChunkDraft:
    text: str
    chunk_index: int
    section_title: str
    page_number: int | None = None


def _safe_file_name(raw_name: str | None) -> str:
    file_name = (raw_name or "").replace("\\", "/").rsplit("/", 1)[-1].strip()
    if not file_name:
        raise HTTPException(status_code=422, detail="文件名不能为空")
    if len(file_name) > 255:
        raise HTTPException(status_code=422, detail="文件名不能超过 255 个字符")
    return file_name


def _file_suffix(file_name: str) -> str:
    dot_index = file_name.rfind(".")
    return file_name[dot_index:].lower() if dot_index >= 0 else ""


def _is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return True


def _storage_subdir(usage_type: str) -> Path:
    if usage_type == "official_knowledge":
        return Path("knowledge") / "original"
    if usage_type == "session_attachment":
        return Path("user_uploads") / "session_attachments"
    return Path("user_uploads") / "personal_references"


def _persist_original_file(
    *,
    storage_root: str | None,
    usage_type: str,
    file_uuid: str,
    file_name: str,
    content: bytes,
) -> tuple[str, str]:
    if not storage_root:
        return "", ""
    root = Path(storage_root).expanduser().resolve()
    suffix = _file_suffix(file_name)
    stored_file_name = f"{file_uuid}{suffix}"
    target_dir = (root / _storage_subdir(usage_type)).resolve()
    target_path = (target_dir / stored_file_name).resolve()
    if not _is_relative_to(target_path, root):
        raise HTTPException(status_code=500, detail="知识文件存储路径无效")
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path.write_bytes(content)
    return stored_file_name, str(target_path)


def _decode_utf8_text(data: bytes, *, message: str) -> str:
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=422, detail=message) from exc


def _rows_to_text(rows: list[list[str]]) -> str:
    lines: list[str] = []
    for row in rows:
        cleaned_cells = [cell.strip() for cell in row]
        while cleaned_cells and not cleaned_cells[-1]:
            cleaned_cells.pop()
        if cleaned_cells:
            lines.append(" | ".join(cell or "待确认" for cell in cleaned_cells))
    return "\n".join(lines).strip()


def _parse_csv_text(data: bytes) -> str:
    text = _decode_utf8_text(data, message="CSV 知识文件必须使用 UTF-8 编码")
    try:
        rows = [list(row) for row in csv.reader(StringIO(text))]
    except csv.Error as exc:
        raise HTTPException(status_code=422, detail="CSV 文件无法解析") from exc
    return _rows_to_text(rows)


def _xlsx_shared_strings(archive: ZipFile) -> list[str]:
    try:
        shared_strings = archive.read("xl/sharedStrings.xml")
    except KeyError:
        return []
    try:
        root = ET.fromstring(shared_strings)
    except ET.ParseError as exc:
        raise HTTPException(status_code=422, detail="XLSX 共享字符串无法解析") from exc
    values: list[str] = []
    for item in root.findall(".//{*}si"):
        text_parts = [
            text_node.text or ""
            for text_node in item.findall(".//{*}t")
        ]
        values.append("".join(text_parts))
    return values


def _xlsx_cell_text(cell: ET.Element, shared_strings: list[str]) -> str:
    cell_type = cell.attrib.get("t", "")
    if cell_type == "inlineStr":
        text_node = cell.find(".//{*}t")
        return (text_node.text or "") if text_node is not None else ""

    value_node = cell.find("{*}v")
    if value_node is None or value_node.text is None:
        return ""
    raw_value = value_node.text.strip()
    if cell_type == "s":
        try:
            return shared_strings[int(raw_value)]
        except (ValueError, IndexError) as exc:
            raise HTTPException(status_code=422, detail="XLSX 单元格共享字符串索引无效") from exc
    return raw_value


def _parse_xlsx_text(data: bytes) -> str:
    try:
        with ZipFile(BytesIO(data)) as archive:
            shared_strings = _xlsx_shared_strings(archive)
            worksheet_names = sorted(
                name
                for name in archive.namelist()
                if name.startswith("xl/worksheets/") and name.endswith(".xml")
            )
            rows: list[list[str]] = []
            for worksheet_name in worksheet_names:
                try:
                    root = ET.fromstring(archive.read(worksheet_name))
                except ET.ParseError as exc:
                    raise HTTPException(status_code=422, detail="XLSX 工作表无法解析") from exc
                for row in root.findall(".//{*}row"):
                    rows.append([
                        _xlsx_cell_text(cell, shared_strings)
                        for cell in row.findall("{*}c")
                    ])
    except BadZipFile as exc:
        raise HTTPException(status_code=422, detail="XLSX 文件无法解析") from exc
    except KeyError as exc:
        raise HTTPException(status_code=422, detail="XLSX 文件结构不完整") from exc
    return _rows_to_text(rows)


def _decode_pdf_literal(raw_value: str) -> str:
    chars: list[str] = []
    index = 0
    while index < len(raw_value):
        char = raw_value[index]
        if char != "\\":
            chars.append(char)
            index += 1
            continue
        index += 1
        if index >= len(raw_value):
            break
        escaped = raw_value[index]
        if escaped in {"\\", "(", ")"}:
            chars.append(escaped)
        elif escaped == "n":
            chars.append("\n")
        elif escaped == "r":
            chars.append("\r")
        elif escaped == "t":
            chars.append("\t")
        elif escaped in {"b", "f"}:
            chars.append(" ")
        elif escaped.isdigit():
            octal = escaped
            lookahead = index + 1
            while lookahead < len(raw_value) and len(octal) < 3 and raw_value[lookahead].isdigit():
                octal += raw_value[lookahead]
                lookahead += 1
            try:
                chars.append(chr(int(octal, 8)))
            except ValueError:
                chars.append(octal)
            index = lookahead - 1
        else:
            chars.append(escaped)
        index += 1
    return "".join(chars)


def _parse_pdf_text_with_library(data: bytes) -> str:
    try:
        from pypdf import PdfReader  # type: ignore
    except Exception:
        return ""

    try:
        reader = PdfReader(BytesIO(data))
        page_texts = [
            f"[第 {page_index} 页]\n{page.extract_text() or ''}".strip()
            for page_index, page in enumerate(reader.pages, start=1)
        ]
    except Exception as exc:
        raise HTTPException(status_code=422, detail="PDF 文件无法解析") from exc
    return "\n\n".join(text for text in page_texts if text).strip()


def _parse_pdf_text_fallback(data: bytes) -> str:
    decoded = data.decode("utf-8", errors="ignore")
    literal_values = [
        _decode_pdf_literal(match.group(1)).strip()
        for match in PDF_LITERAL_PATTERN.finditer(decoded)
    ]
    text = "\n".join(value for value in literal_values if value).strip()
    if text:
        return text
    return ""


def _parse_pdf_text(data: bytes) -> str:
    text = _parse_pdf_text_with_library(data) or _parse_pdf_text_fallback(data)
    if not text:
        raise HTTPException(
            status_code=422,
            detail="PDF 未提取到可用文本，扫描件或图片型 PDF 需要 OCR 后再上传",
        )
    return text


def _extract_text(file_name: str, data: bytes) -> str:
    suffix = _file_suffix(file_name)
    if suffix not in SUPPORTED_KNOWLEDGE_SUFFIXES:
        raise HTTPException(status_code=415, detail=UNSUPPORTED_KNOWLEDGE_TYPE_MESSAGE)
    if suffix in {".txt", ".md"}:
        return _decode_utf8_text(data, message="文本知识文件必须使用 UTF-8 编码")
    if suffix == ".csv":
        return _parse_csv_text(data)
    if suffix == ".xlsx":
        return _parse_xlsx_text(data)
    if suffix == ".pdf":
        return _parse_pdf_text(data)
    return _parse_docx_text(data)


def _section_blocks(text: str) -> list[tuple[str, str]]:
    blocks: list[tuple[str, str]] = []
    current_title = ""
    current_lines: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if HEADING_PATTERN.match(line):
            if current_lines:
                blocks.append((current_title, "\n".join(current_lines)))
            current_title = line
            current_lines = [line]
            continue
        current_lines.append(line)
    if current_lines:
        blocks.append((current_title, "\n".join(current_lines)))
    if blocks:
        return blocks
    stripped = text.strip()
    return [("", stripped)] if stripped else []


def chunk_text(
    text: str,
    *,
    target_chars: int = 1000,
    max_chars: int = 1500,
    overlap_chars: int = 150,
) -> list[ChunkDraft]:
    if max_chars <= 0:
        raise ValueError("max_chars must be greater than 0")
    safe_overlap = max(0, min(overlap_chars, max_chars - 1))
    safe_target = max(1, min(target_chars, max_chars))
    chunks: list[ChunkDraft] = []
    for section_title, content in _section_blocks(text):
        start = 0
        while start < len(content):
            end = min(start + max_chars, len(content))
            chunk_body = content[start:end].strip()
            if chunk_body:
                chunks.append(
                    ChunkDraft(
                        text=chunk_body,
                        chunk_index=len(chunks),
                        section_title=section_title,
                    )
                )
            if end >= len(content):
                break
            next_start = end - safe_overlap
            if end - start > safe_target and safe_overlap == 0:
                next_start = end
            start = max(start + 1, next_start)
    return chunks


def _token_estimate(text: str) -> int:
    return max(1, len(text) // 2)


def create_knowledge_file_from_bytes(
    db: Session,
    *,
    sso_user_id: str,
    file_name: str,
    content: bytes,
    content_type: str,
    cipher: ContentCipher,
    key_version: str,
    visibility: str = "PRIVATE",
    source_type: str = "user_upload",
    usage_type: str = "personal_reference",
    review_status: str = "draft",
    rag_enabled: bool = False,
    reference_enabled: bool = True,
    rag_scope: str = "personal",
    permission_scope: str = "private",
    owner_user_id: str | None = None,
    conversation_id: str = "",
    category: str = "个人素材",
    document_type: str = "其他",
    tags: list[str] | None = None,
    uploaded_by: str | None = None,
    knowledge_base_id: int | None = None,
    target_chars: int = 1000,
    max_chars: int = 1500,
    overlap_chars: int = 150,
    storage_root: str | None = None,
) -> tuple[KnowledgeFile, list[KnowledgeChunk]]:
    safe_name = _safe_file_name(file_name)
    if len(content) > MAX_KNOWLEDGE_FILE_BYTES:
        raise HTTPException(status_code=413, detail="知识文件大小不能超过 20 MB")

    extracted_text = _extract_text(safe_name, content)
    file_uuid = str(uuid_lib.uuid4())
    stored_file_name, file_path = _persist_original_file(
        storage_root=storage_root,
        usage_type=usage_type,
        file_uuid=file_uuid,
        file_name=safe_name,
        content=content,
    )
    file_record = KnowledgeFile(
        uuid=file_uuid,
        knowledge_base_id=knowledge_base_id,
        sso_user_id=sso_user_id,
        file_name=safe_name,
        original_file_name=safe_name,
        stored_file_name=stored_file_name,
        file_path=file_path,
        file_type=(content_type or "application/octet-stream")[:128],
        file_size=len(content),
        content_sha256=hashlib.sha256(content).hexdigest(),
        visibility=visibility,
        status="READY",
        error_code="",
        key_version=key_version,
        category=category,
        document_type=document_type,
        tags_json=tags or [],
        parse_status="parsed",
        index_status="indexed",
        source_type=source_type,
        usage_type=usage_type,
        review_status=review_status,
        rag_enabled=rag_enabled,
        reference_enabled=reference_enabled,
        rag_scope=rag_scope,
        permission_scope=permission_scope,
        owner_user_id=owner_user_id or sso_user_id,
        conversation_id=conversation_id,
        uploaded_by=uploaded_by or sso_user_id,
    )
    db.add(file_record)
    db.flush()

    chunk_records: list[KnowledgeChunk] = []
    for draft in chunk_text(
        extracted_text,
        target_chars=target_chars,
        max_chars=max_chars,
        overlap_chars=overlap_chars,
    ):
        chunk_id = str(uuid_lib.uuid4())
        encrypted = cipher.encrypt_json({"text": draft.text}, chunk_id.encode())
        chunk = KnowledgeChunk(
            chunk_id=chunk_id,
            file_id=file_record.id,
            knowledge_base_id=knowledge_base_id,
            file_name=safe_name,
            chunk_text_ciphertext=encrypted.ciphertext,
            chunk_text_nonce=encrypted.nonce,
            page_number=draft.page_number,
            section_title=draft.section_title,
            chunk_index=draft.chunk_index,
            token_estimate=_token_estimate(draft.text),
            token_count=_token_estimate(draft.text),
            metadata_json={
                "source_type": source_type,
                "usage_type": usage_type,
                "review_status": review_status,
                "rag_scope": rag_scope,
                "permission_scope": permission_scope,
            },
            status="READY",
        )
        db.add(chunk)
        chunk_records.append(chunk)
    db.flush()
    return file_record, chunk_records


def reparse_knowledge_file_from_existing_chunks(
    db: Session,
    *,
    file_record: KnowledgeFile,
    cipher: ContentCipher,
    target_chars: int = 1000,
    max_chars: int = 1500,
    overlap_chars: int = 150,
    storage_root: str | None = None,
) -> list[KnowledgeChunk]:
    source_text = ""
    if storage_root and file_record.file_path:
        root = Path(storage_root).expanduser().resolve()
        original_path = Path(file_record.file_path).expanduser().resolve()
        if _is_relative_to(original_path, root) and original_path.is_file():
            source_name = file_record.original_file_name or file_record.file_name
            source_text = _extract_text(source_name, original_path.read_bytes()).strip()

    existing_chunks = list(
        db.scalars(
            select(KnowledgeChunk)
            .where(
                KnowledgeChunk.file_id == file_record.id,
                KnowledgeChunk.status == "READY",
                KnowledgeChunk.deleted_at.is_(None),
            )
            .order_by(KnowledgeChunk.chunk_index.asc())
        )
    )
    if not source_text and not existing_chunks:
        raise HTTPException(status_code=422, detail="当前文档没有可重解析的内容")

    if not source_text:
        text_parts: list[str] = []
        for chunk in existing_chunks:
            payload = cipher.decrypt_json(
                EncryptedPayload(
                    ciphertext=chunk.chunk_text_ciphertext,
                    nonce=chunk.chunk_text_nonce,
                ),
                chunk.chunk_id.encode(),
            )
            text = str(payload.get("text", "")).strip()
            if text:
                text_parts.append(text)
        source_text = "\n".join(text_parts).strip()
    if not source_text:
        raise HTTPException(status_code=422, detail="当前文档没有可重解析的文本")

    db.execute(delete(KnowledgeChunk).where(KnowledgeChunk.file_id == file_record.id))
    db.flush()

    rebuilt_chunks: list[KnowledgeChunk] = []
    for draft in chunk_text(
        source_text,
        target_chars=target_chars,
        max_chars=max_chars,
        overlap_chars=overlap_chars,
    ):
        chunk_id = str(uuid_lib.uuid4())
        encrypted = cipher.encrypt_json({"text": draft.text}, chunk_id.encode())
        token_count = _token_estimate(draft.text)
        chunk = KnowledgeChunk(
            chunk_id=chunk_id,
            file_id=file_record.id,
            knowledge_base_id=file_record.knowledge_base_id,
            file_name=file_record.file_name,
            chunk_text_ciphertext=encrypted.ciphertext,
            chunk_text_nonce=encrypted.nonce,
            page_number=draft.page_number,
            section_title=draft.section_title,
            chunk_index=draft.chunk_index,
            token_estimate=token_count,
            token_count=token_count,
            metadata_json={
                "source_type": file_record.source_type,
                "usage_type": file_record.usage_type,
                "review_status": file_record.review_status,
                "rag_scope": file_record.rag_scope,
                "permission_scope": file_record.permission_scope,
            },
            status="READY",
        )
        db.add(chunk)
        rebuilt_chunks.append(chunk)
    file_record.parse_status = "parsed"
    file_record.index_status = "indexed"
    file_record.error_code = ""
    db.flush()
    return rebuilt_chunks
