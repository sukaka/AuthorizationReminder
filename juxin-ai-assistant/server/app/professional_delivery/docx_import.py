"""Bounded DOCX -> structured deliverable content import.

The importer intentionally returns document blocks without persisting a draft.
Callers receive image package bytes separately and must pass them through the
existing encrypted, signature-scanned media asset service before exposing an
asset reference in editor content.
"""

from __future__ import annotations

import hashlib
import json
import mimetypes
import posixpath
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from io import BytesIO
from typing import Any
from zipfile import BadZipFile

from docx import Document
from docx.oxml.table import CT_Tbl
from docx.oxml.text.paragraph import CT_P
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph
from fastapi import HTTPException

from ..knowledge_files import _validated_document_archive


MAX_DOCX_IMPORT_BYTES = 25 * 1024 * 1024
_HEADING_PATTERN = re.compile(r"^(#{1,6}\s+|[一二三四五六七八九十]+、|\d+[.．、]|\（\d+\）)\S+")
_RELATIONSHIP_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
_IMAGE_RELATIONSHIP_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
_ALLOWED_MEDIA_MIME_TYPES = frozenset({
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
})

_WARNING_MESSAGES = {
    "media_external": "外链图片未下载，需在编辑器中重新插入",
    "media_path_invalid": "图片路径不在 DOCX 媒体目录中，已拒绝导入",
    "media_missing": "DOCX 引用的图片文件不存在",
    "media_unsupported": "图片格式不在当前编辑器支持范围内",
    "floating_layout": "浮动图片已按文档顺序转为图片块，位置和文字环绕不会保留",
    "headers_footers": "页眉或页脚未导入块编辑器，导出时使用聚信模板页眉页脚",
    "lists": "Word 列表编号和缩进未保留为可编辑列表属性",
    "hyperlinks": "超链接文本已保留，但链接地址和打开方式未导入",
    "fields": "Word 域或内容控件已按静态文本处理，不会动态更新",
    "tracked_changes": "修订记录未保留，仅导入当前可见文本",
    "comments": "Word 批注未导入，需在聚信编辑器中重新添加评论",
    "nested_tables": "嵌套表格未完整导入，已保留外层表格文本",
    "alt_chunk": "外部 HTML 内容未下载，已拒绝导入",
    "ole_objects": "嵌入对象不是块编辑器支持的媒体，已拒绝导入",
    "macros": "宏和 VBA 工程不会导入或执行",
}

# These package features can carry executable or opaque binary content.  They
# are deliberately reported separately from ordinary visual degradation so a
# caller can reject the import in a high-assurance workflow.
_REJECTED_FEATURE_CODES = frozenset({"alt_chunk", "ole_objects", "macros"})


@dataclass(frozen=True, slots=True)
class ImportedDocxMedia:
    """One package image, kept out of the JSON response until it is persisted."""

    source_id: str
    original_file_name: str
    media_type: str
    data: bytes


def _import_error() -> HTTPException:
    return HTTPException(
        status_code=422,
        detail={"code": "INVALID_DOCX_IMPORT", "message": "DOCX 文件无法解析"},
    )


def _stable_block_id(index: int, block_type: str, value: Any) -> str:
    encoded = json.dumps(
        {"index": index, "type": block_type, "value": value},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"docx-{index + 1}-{hashlib.sha256(encoded).hexdigest()[:12]}"


def _heading_level(paragraph: Paragraph, text: str) -> int:
    style_name = (paragraph.style.name if paragraph.style else "").lower()
    if style_name.startswith("heading"):
        match = re.search(r"(\d+)", style_name)
        return max(1, min(int(match.group(1)) if match else 1, 6))
    return 1 if _HEADING_PATTERN.match(text) else 0


def _relationship_media_ids(paragraph: Paragraph) -> list[str]:
    """Return image relationship IDs in their XML order.

    python-docx exposes inline shapes but not VML pictures, and its XPath
    helper does not register every Office namespace. Walking local names keeps
    both DrawingML (``a:blip``) and legacy VML (``v:imagedata``) bounded and
    independent of the producer that authored the DOCX.
    """
    relationship_ids: list[str] = []
    for node in paragraph._p.iter():
        local_name = node.tag.rsplit("}", 1)[-1] if isinstance(node.tag, str) else ""
        if local_name == "blip":
            relationship_id = node.get(qn("r:embed")) or node.get(qn("r:link"))
        elif local_name == "imagedata":
            relationship_id = node.get(qn("r:id"))
        else:
            continue
        if relationship_id:
            relationship_ids.append(relationship_id)
    return relationship_ids


def _media_type_for_target(
    target: str,
    *,
    defaults: dict[str, str],
    overrides: dict[str, str],
) -> str:
    normalized_target = "/" + target.lstrip("/")
    override = overrides.get(normalized_target)
    if override:
        return override.lower().strip()
    extension = posixpath.splitext(target.rsplit("/", 1)[-1])[1].lstrip(".").lower()
    if extension in defaults:
        return defaults[extension]
    guessed, _ = mimetypes.guess_type(target)
    return str(guessed or "").lower()


def _docx_media_relationships(
    archive: Any,
) -> tuple[dict[str, ImportedDocxMedia | None], list[str]]:
    """Load safe ``rId -> word/media/*`` mappings from an Office package."""
    try:
        relationships_root = ET.fromstring(archive.read("word/_rels/document.xml.rels"))
    except KeyError:
        return {}, []
    except ET.ParseError as exc:
        raise _import_error() from exc

    defaults: dict[str, str] = {}
    overrides: dict[str, str] = {}
    try:
        content_types_root = ET.fromstring(archive.read("[Content_Types].xml"))
    except KeyError:
        content_types_root = None
    except ET.ParseError as exc:
        raise _import_error() from exc
    if content_types_root is not None:
        for element in content_types_root:
            local_name = element.tag.rsplit("}", 1)[-1]
            if local_name == "Default":
                extension = (element.attrib.get("Extension") or "").strip().lower()
                content_type = (element.attrib.get("ContentType") or "").strip().lower()
                if extension and content_type:
                    defaults[extension] = content_type
            elif local_name == "Override":
                part_name = (element.attrib.get("PartName") or "").strip()
                content_type = (element.attrib.get("ContentType") or "").strip().lower()
                if part_name and content_type:
                    overrides[part_name] = content_type

    media: dict[str, ImportedDocxMedia | None] = {}
    warnings: list[str] = []
    for relationship in relationships_root.findall(f"{{{_RELATIONSHIP_NS}}}Relationship"):
        relationship_id = (relationship.attrib.get("Id") or "").strip()
        relationship_type = (relationship.attrib.get("Type") or "").strip()
        target = (relationship.attrib.get("Target") or "").replace("\\", "/").strip()
        if not relationship_id or relationship_type != _IMAGE_RELATIONSHIP_TYPE:
            continue
        # External image links are intentionally not fetched. Relative paths
        # must remain inside word/media after normalization to prevent zip
        # traversal and accidental reads of unrelated package parts.
        if not target or "://" in target or target.startswith("/"):
            warnings.append("media_external")
            media[relationship_id] = None
            continue
        package_target = posixpath.normpath(posixpath.join("word", target))
        if not package_target.startswith("word/media/") or package_target in {"word/media", "word/media/."}:
            warnings.append("media_path_invalid")
            media[relationship_id] = None
            continue
        try:
            data = archive.read(package_target)
        except KeyError:
            warnings.append("media_missing")
            media[relationship_id] = None
            continue
        media_type = _media_type_for_target(
            package_target,
            defaults=defaults,
            overrides=overrides,
        )
        if media_type not in _ALLOWED_MEDIA_MIME_TYPES:
            warnings.append("media_unsupported")
            media[relationship_id] = None
            continue
        media[relationship_id] = ImportedDocxMedia(
            source_id=package_target,
            original_file_name=posixpath.basename(package_target),
            media_type=media_type,
            data=data,
        )
    return media, warnings


def _docx_feature_warnings(archive: Any) -> list[str]:
    """Detect DOCX constructs the block model cannot represent losslessly.

    This is intentionally a bounded, package-local inspection.  It never
    follows external relationships or executes embedded content.  The parser
    still imports safe text where possible, while the returned codes make any
    downgrade/rejection explicit to API clients and audit records.
    """
    warnings: list[str] = []
    names = set(archive.namelist())

    if any(name.startswith("word/header") or name.startswith("word/footer") for name in names):
        warnings.append("headers_footers")
    if any(name.startswith("word/comments") for name in names):
        warnings.append("comments")
    if any(name.startswith("word/embeddings/") or name.startswith("word/activeX/") for name in names):
        warnings.append("ole_objects")
    if any(name.lower().endswith("vbaproject.bin") for name in names):
        warnings.append("macros")

    try:
        document_xml = archive.read("word/document.xml")
        root = ET.fromstring(document_xml)
    except KeyError:
        return warnings
    except ET.ParseError as exc:
        raise _import_error() from exc

    local_names = [
        element.tag.rsplit("}", 1)[-1]
        for element in root.iter()
        if isinstance(element.tag, str)
    ]
    local_name_set = set(local_names)
    if "anchor" in local_name_set:
        warnings.append("floating_layout")
    if "numPr" in local_name_set:
        warnings.append("lists")
    if "hyperlink" in local_name_set:
        warnings.append("hyperlinks")
    if {"fldChar", "instrText", "sdt"} & local_name_set:
        warnings.append("fields")
    if {"ins", "del", "moveFrom", "moveTo"} & local_name_set:
        warnings.append("tracked_changes")
    if {"commentRangeStart", "commentRangeEnd", "commentReference"} & local_name_set:
        warnings.append("comments")
    if "altChunk" in local_name_set:
        warnings.append("alt_chunk")

    # A nested table is represented by a second w:tbl under a table cell.  It
    # is not exposed by the current table block adapter and would otherwise be
    # silently dropped.
    for table in root.iter():
        if not isinstance(table.tag, str) or table.tag.rsplit("}", 1)[-1] != "tbl":
            continue
        if any(
            isinstance(descendant.tag, str)
            and descendant.tag.rsplit("}", 1)[-1] == "tbl"
            for descendant in table.iter()
            if descendant is not table
        ):
            warnings.append("nested_tables")
            break
    return list(dict.fromkeys(warnings))


def _paragraph_block(paragraph: Paragraph, index: int) -> dict[str, Any] | None:
    text = paragraph.text.strip()
    has_media = bool(paragraph._p.xpath(".//w:drawing | .//w:pict"))
    if not text and not has_media:
        return None
    if not text:
        return None
    level = _heading_level(paragraph, text)
    block: dict[str, Any] = {
        "block_id": _stable_block_id(index, "heading" if level else "paragraph", text),
        "type": "heading" if level else "paragraph",
        "text": text,
    }
    if level:
        block["level"] = level
    return block


def _table_block(table: Table, index: int) -> dict[str, Any] | None:
    rows = [
        {"cells": [{"text": cell.text.strip()} for cell in row.cells]}
        for row in table.rows
    ]
    if not rows:
        return None
    return {
        "block_id": _stable_block_id(index, "table", rows),
        "type": "table",
        "rows": rows,
    }


def _import_report(
    *,
    warnings: list[str],
    blocks: list[dict[str, Any]],
) -> dict[str, Any]:
    """Return a stable, machine-readable import assessment.

    ``warnings`` remains part of the legacy contract.  The report makes the
    editor's downgrade visible without claiming that complex Word layout is
    losslessly represented by the block model.
    """
    unique_warnings = list(dict.fromkeys(str(item) for item in warnings))
    supported_features = sorted(
        {
            str(block.get("type"))
            for block in blocks
            if isinstance(block, dict) and block.get("type")
        }
    )
    rejected = [
        {
            "code": code,
            "message": _WARNING_MESSAGES.get(code, "DOCX 内容已拒绝导入"),
        }
        for code in unique_warnings
        if code in _REJECTED_FEATURE_CODES
    ]
    degraded = [
        {
            "code": code,
            "message": _WARNING_MESSAGES.get(code, "DOCX 内容已降级处理"),
        }
        for code in unique_warnings
        if code not in _REJECTED_FEATURE_CODES
    ]
    status = "supported"
    if rejected and not blocks:
        status = "rejected"
    elif rejected or degraded:
        status = "degraded"
    return {
        "status": status,
        "supported_features": supported_features,
        "degraded_features": degraded,
        "rejected_features": rejected,
    }


def structured_content_and_media_from_docx(
    data: bytes,
) -> tuple[dict[str, Any], list[ImportedDocxMedia]]:
    """Parse bounded DOCX blocks and return embedded media outside the JSON.

    The relationship graph is the source of truth for package media. The
    returned list contains each package asset once, while image blocks retain
    every occurrence so repeated pictures keep their document order.
    """
    if not isinstance(data, bytes) or not data or len(data) > MAX_DOCX_IMPORT_BYTES:
        raise _import_error()
    try:
        with _validated_document_archive(data, file_kind="DOCX") as archive:
            warnings = _docx_feature_warnings(archive)
            relationship_media, media_warnings = _docx_media_relationships(archive)
            warnings.extend(media_warnings)
            warnings = list(dict.fromkeys(warnings))
        document = Document(BytesIO(data))
        blocks: list[dict[str, Any]] = []
        imported_media: list[ImportedDocxMedia] = []
        media_by_source: dict[str, ImportedDocxMedia] = {}
        media_count = 0
        block_index = 0

        def append_media_blocks(paragraph: Paragraph) -> None:
            nonlocal block_index, media_count
            for relationship_id in _relationship_media_ids(paragraph):
                media_count += 1
                media = relationship_media.get(relationship_id)
                if media is None:
                    continue
                if media.source_id not in media_by_source:
                    media_by_source[media.source_id] = media
                    imported_media.append(media)
                blocks.append(
                    {
                        "block_id": _stable_block_id(
                            block_index,
                            "image",
                            {
                                "source_id": media.source_id,
                                "mime_type": media.media_type,
                                "size_bytes": len(media.data),
                            },
                        ),
                        "type": "image",
                        "source_id": media.source_id,
                        "original_file_name": media.original_file_name,
                        "mime_type": media.media_type,
                        "size_bytes": len(media.data),
                    }
                )
                block_index += 1

        for child in document.element.body.iterchildren():
            block: dict[str, Any] | None = None
            if isinstance(child, CT_P):
                paragraph = Paragraph(child, document)
                block = _paragraph_block(paragraph, block_index)
                if block is not None:
                    blocks.append(block)
                    block_index += 1
                append_media_blocks(paragraph)
            elif isinstance(child, CT_Tbl):
                table = Table(child, document)
                block = _table_block(table, block_index)
                if block is not None:
                    blocks.append(block)
                    block_index += 1
                # Pictures can be nested in table cells. python-docx does not
                # expose a table-level shape collection, so inspect cell
                # paragraphs after the table block while retaining occurrence
                # order within each row.
                for row in table.rows:
                    for cell in row.cells:
                        for paragraph in cell.paragraphs:
                            append_media_blocks(paragraph)
        return {
            "schema_version": "2",
            "blocks": blocks,
            "import_meta": {
                "source_format": "docx",
                "warnings": warnings,
                "media_count": media_count,
                "import_report": _import_report(warnings=warnings, blocks=blocks),
            },
        }, imported_media
    except HTTPException:
        raise _import_error()
    except (BadZipFile, ValueError, TypeError, AttributeError, KeyError) as exc:
        raise _import_error() from exc
    except Exception as exc:
        # python-docx can raise implementation-specific XML errors. Keep the
        # API contract stable and do not expose parser internals to clients.
        raise _import_error() from exc


def structured_content_from_docx(data: bytes) -> dict[str, Any]:
    """Compatibility parser that reports media but omits asset references."""
    content, _ = structured_content_and_media_from_docx(data)
    blocks = [
        block
        for block in content["blocks"]
        if isinstance(block, dict) and block.get("type") != "image"
    ]
    import_meta = dict(content["import_meta"])
    warnings = list(import_meta.get("warnings") or [])
    if import_meta.get("media_count"):
        warnings.append("media_not_imported")
    import_meta["warnings"] = list(dict.fromkeys(str(item) for item in warnings))
    import_meta["import_report"] = _import_report(warnings=warnings, blocks=blocks)
    return {
        "schema_version": content["schema_version"],
        "blocks": blocks,
        "import_meta": import_meta,
    }
