from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..chat_word_export import TemplateRenderer
from ..crypto import ContentCipher
from ..export_file_manager import ExportFileManager
from ..models import WorkArtifact, WorkArtifactVersion
from .models import DeliverableExport, TemplateVersion
from .schemas import DeliverableExportCreateIn
from .service import (
    DeliverableAccess,
    ProfessionalDeliveryError,
    deliverable_version_payload,
    get_deliverable_version,
    get_visible_deliverable,
)


RENDERER_VERSION = "professional-docx-v1"
UNAPPROVED_MARKER = "> 文档状态：未批准，仅供内部审阅"

# Keep this list aligned with the block editor and the deterministic Markdown
# renderer below.  Anything outside it must be visible in the export report;
# silently dropping a future block type would make a DOCX look complete when it
# is not.
_EXPORT_SUPPORTED_BLOCK_TYPES = frozenset(
    {
        "paragraph",
        "heading",
        "title",
        "section",
        "table",
        "image",
        "media",
        "list",
        "bullet_list",
        "ordered_list",
        "quote",
        "notice",
        "divider",
    }
)
_EXPORT_FEATURE_MESSAGES = {
    "invalid_content": "结构化正文缺少可导出的内容块列表",
    "empty_content": "结构化正文没有内容块，已回退到版本摘要",
    "invalid_block": "内容块不是结构化对象，无法确定其语义",
    "missing_block_type": "内容块缺少类型，无法确定其渲染方式",
    "unsupported_block_type": "内容块类型未被 DOCX 渲染器支持，已保留显式占位",
    "empty_block": "内容块没有可导出的文本",
    "empty_table": "表格没有可导出的行",
    "invalid_list": "列表没有可导出的条目",
    "media_asset_not_embedded": "当前 DOCX 渲染器只输出图片说明，素材未嵌入文件",
}


@dataclass(frozen=True, slots=True)
class DeliverableExportCreateResult:
    access: DeliverableAccess
    version: WorkArtifactVersion
    export: DeliverableExport
    replayed: bool
    created_file_path: str | None
    export_report: dict[str, Any] | None = None


@dataclass(frozen=True, slots=True)
class DeliverableExportDownloadResult:
    access: DeliverableAccess
    export: DeliverableExport
    content: bytes


def _canonical_hash(value: dict[str, Any]) -> str:
    raw = json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _request_hash(
    *,
    deliverable_uuid: str,
    version_uuid: str,
    body: DeliverableExportCreateIn,
) -> str:
    return _canonical_hash(
        {
            "deliverable_uuid": deliverable_uuid,
            "version_uuid": version_uuid,
            "body": body.model_dump(mode="json"),
        }
    )


def _idempotency_reused() -> ProfessionalDeliveryError:
    return ProfessionalDeliveryError(
        "IDEMPOTENCY_KEY_REUSED",
        "Idempotency-Key 已用于其他请求",
        409,
    )


def _cell_text(value: object) -> str:
    if isinstance(value, dict):
        value = value.get("text", value.get("value", value.get("content", "")))
    if value is None:
        return ""
    if isinstance(value, (str, int, float, bool)):
        return str(value).strip()
    return ""


def _table_markdown(block: dict[str, Any]) -> list[str]:
    raw_rows = block.get("rows")
    if not isinstance(raw_rows, list):
        return []
    rows: list[list[str]] = []
    for raw_row in raw_rows:
        cells = raw_row.get("cells") if isinstance(raw_row, dict) else raw_row
        if not isinstance(cells, list):
            continue
        rows.append([_cell_text(cell).replace("|", "\\|") for cell in cells])
    if not rows:
        return []
    if not any(cell for row in rows for cell in row):
        return []
    width = max(len(row) for row in rows)
    normalized = [row + [""] * (width - len(row)) for row in rows]
    lines = [
        "| " + " | ".join(normalized[0]) + " |",
        "| " + " | ".join(["---"] * width) + " |",
    ]
    lines.extend("| " + " | ".join(row) + " |" for row in normalized[1:])
    return lines


def _export_feature(
    code: str,
    *,
    block_index: int | None = None,
    block_type: str | None = None,
) -> dict[str, Any]:
    item: dict[str, Any] = {
        "code": code,
        "message": _EXPORT_FEATURE_MESSAGES.get(code, "内容块导出需要人工确认"),
    }
    if block_index is not None:
        item["block_index"] = block_index
    if block_type:
        item["block_type"] = block_type
    return item


def structured_content_export_report(content: dict[str, Any]) -> dict[str, Any]:
    """Assess how faithfully structured content can be rendered to DOCX.

    The report is deliberately independent from the renderer so callers can
    display a warning before creating a file.  Unknown blocks are classified as
    rejected features, while the overall export remains ``degraded`` because
    the renderer emits an explicit placeholder instead of silently dropping
    user content.
    """
    if not isinstance(content, dict):
        return {
            "status": "rejected",
            "supported_features": [],
            "degraded_features": [],
            "rejected_features": [_export_feature("invalid_content")],
        }
    blocks = content.get("blocks")
    if not isinstance(blocks, list):
        return {
            "status": "rejected",
            "supported_features": [],
            "degraded_features": [],
            "rejected_features": [_export_feature("invalid_content")],
        }

    supported: set[str] = set()
    degraded: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    for index, raw_block in enumerate(blocks):
        if not isinstance(raw_block, dict):
            rejected.append(_export_feature("invalid_block", block_index=index))
            continue
        block_type = str(raw_block.get("type") or "").strip().lower()
        if not block_type:
            rejected.append(_export_feature("missing_block_type", block_index=index))
            continue
        if block_type not in _EXPORT_SUPPORTED_BLOCK_TYPES:
            rejected.append(
                _export_feature(
                    "unsupported_block_type",
                    block_index=index,
                    block_type=block_type[:64],
                )
            )
            continue
        supported.add(block_type)
        if block_type in {"image", "media"}:
            degraded.append(
                _export_feature(
                    "media_asset_not_embedded",
                    block_index=index,
                    block_type=block_type,
                )
            )
        elif block_type == "table":
            if not _table_markdown(raw_block):
                degraded.append(_export_feature("empty_table", block_index=index, block_type=block_type))
        elif block_type in {"list", "bullet_list", "ordered_list"}:
            items = raw_block.get("items")
            if not isinstance(items, list) or not any(_cell_text(item) for item in items):
                degraded.append(_export_feature("invalid_list", block_index=index, block_type=block_type))
        elif block_type in {"paragraph", "heading", "title", "section", "quote", "notice"}:
            text = _cell_text(raw_block.get("text", raw_block.get("content", raw_block.get("value"))))
            if not text:
                label = _cell_text(raw_block.get("label"))
                value = _cell_text(raw_block.get("value"))
                text = f"{label}：{value}" if label and value else ""
            if not text:
                degraded.append(_export_feature("empty_block", block_index=index, block_type=block_type))

    if not blocks:
        degraded.append(_export_feature("empty_content"))
    if rejected or degraded:
        status = "degraded" if blocks else "rejected"
    else:
        status = "supported"
    return {
        "status": status,
        "supported_features": sorted(supported),
        "degraded_features": degraded,
        "rejected_features": rejected,
    }


def structured_content_to_markdown(
    content: dict[str, Any],
    *,
    fallback: str,
) -> str:
    blocks = content.get("blocks")
    if not isinstance(blocks, list):
        return fallback.strip() or "（本版本无可渲染正文）"
    sections: list[str] = []
    for index, raw_block in enumerate(blocks):
        if not isinstance(raw_block, dict):
            sections.append(f"【未支持内容块：第 {index + 1} 个块不是对象】")
            continue
        block_type = str(raw_block.get("type") or "").strip().lower()
        if not block_type:
            sections.append(f"【未支持内容块：第 {index + 1} 个块缺少类型】")
            continue
        if block_type not in _EXPORT_SUPPORTED_BLOCK_TYPES:
            text = _cell_text(raw_block.get("text", raw_block.get("content", raw_block.get("value"))))
            suffix = f"：{text}" if text else ""
            sections.append(f"【未支持内容块：{block_type}】{suffix}")
            continue
        if block_type in {"image", "media"}:
            caption = _cell_text(
                raw_block.get(
                    "caption",
                    raw_block.get("alt", raw_block.get("text", "")),
                )
            )
            if caption:
                sections.append(f"图片：{caption}")
            else:
                sections.append(f"【图片未嵌入：第 {index + 1} 个块】")
            continue
        if block_type == "table":
            table = _table_markdown(raw_block)
            if table:
                sections.append("\n".join(table))
            else:
                sections.append(f"【表格无法导出：第 {index + 1} 个块】")
            continue
        if block_type in {"list", "bullet_list", "ordered_list"}:
            items = raw_block.get("items")
            if isinstance(items, list):
                ordered = block_type == "ordered_list"
                lines = []
                for index, item in enumerate(items, start=1):
                    text = _cell_text(item)
                    if text:
                        prefix = f"{index}." if ordered else "-"
                        lines.append(f"{prefix} {text}")
                if lines:
                    sections.append("\n".join(lines))
                else:
                    sections.append(f"【列表无法导出：第 {index + 1} 个块】")
            else:
                sections.append(f"【列表无法导出：第 {index + 1} 个块】")
            continue
        if block_type == "divider":
            sections.append("---")
            continue
        text = _cell_text(
            raw_block.get("text", raw_block.get("content", raw_block.get("value")))
        )
        if not text:
            label = _cell_text(raw_block.get("label"))
            value = _cell_text(raw_block.get("value"))
            text = f"{label}：{value}" if label and value else ""
        if not text:
            sections.append(f"【空内容块：第 {index + 1} 个块】")
            continue
        if block_type in {"heading", "title", "section"}:
            try:
                level = int(raw_block.get("level") or 2)
            except (TypeError, ValueError):
                level = 2
            sections.append(f"{'#' * min(max(level, 1), 6)} {text}")
        elif block_type == "quote":
            sections.append(f"> {text}" if text else f"【引用无法导出：第 {index + 1} 个块】")
        elif block_type == "notice":
            sections.append(f"> 提示：{text}" if text else f"【提示无法导出：第 {index + 1} 个块】")
        else:
            sections.append(text or f"【空内容块：第 {index + 1} 个块】")
    return "\n\n".join(sections).strip() or fallback.strip() or "（本版本无可渲染正文）"


def _export_payload_content(
    db: Session,
    *,
    version: WorkArtifactVersion,
    cipher: ContentCipher,
    watermarked: bool,
    payload: dict[str, Any] | None = None,
) -> str:
    payload = payload or deliverable_version_payload(db, version=version, cipher=cipher)
    output = structured_content_to_markdown(
        payload["content"],
        fallback=version.summary_snapshot,
    )
    return f"{UNAPPROVED_MARKER}\n\n{output}" if watermarked else output


def create_deliverable_export(
    db: Session,
    *,
    deliverable_uuid: str,
    version_uuid: str,
    body: DeliverableExportCreateIn,
    actor_user_id: str,
    actor_name: str,
    actor_department: str,
    idempotency_key: str,
    request_id: str,
    cipher: ContentCipher,
    file_manager: ExportFileManager,
    renderer: TemplateRenderer | None = None,
) -> DeliverableExportCreateResult:
    access = get_visible_deliverable(
        db,
        deliverable_uuid=deliverable_uuid,
        actor_user_id=actor_user_id,
        lock=True,
    )
    request_hash = _request_hash(
        deliverable_uuid=deliverable_uuid,
        version_uuid=version_uuid,
        body=body,
    )
    existing = db.scalar(
        select(DeliverableExport).where(
            DeliverableExport.created_by == actor_user_id,
            DeliverableExport.idempotency_key == idempotency_key,
        )
    )
    if existing is not None:
        if (
            existing.deliverable_id != access.artifact.id
            or existing.request_hash != request_hash
        ):
            raise _idempotency_reused()
        version = db.get(WorkArtifactVersion, existing.deliverable_version_id)
        if version is None or version.uuid != version_uuid:
            raise ProfessionalDeliveryError(
                "DELIVERABLE_EXPORT_RECORD_INVALID",
                "导出记录绑定的成果版本不可用",
                409,
            )
        replay_payload = deliverable_version_payload(db, version=version, cipher=cipher)
        return DeliverableExportCreateResult(
            access=access,
            version=version,
            export=existing,
            replayed=True,
            created_file_path=None,
            export_report=structured_content_export_report(replay_payload["content"]),
        )

    artifact = access.artifact
    if artifact.row_version != body.row_version:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_VERSION_CONFLICT",
            "成果已被其他操作更新，请刷新后重试",
            409,
            {"current_row_version": artifact.row_version},
        )
    version = get_deliverable_version(
        db,
        artifact=artifact,
        version_uuid=version_uuid,
    )
    if version.content_hash != body.content_hash:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_TARGET_MISMATCH",
            "导出目标版本与内容哈希不一致",
            409,
        )
    template_version = (
        db.get(TemplateVersion, version.template_version_id)
        if version.template_version_id is not None
        else None
    )
    if template_version is None:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_TEMPLATE_NOT_AVAILABLE",
            "成果版本绑定的模板不可用",
            409,
        )

    watermarked = not (
        artifact.approved_version_id == version.id
        and artifact.approved_content_hash == version.content_hash
    )
    render_config = (
        template_version.word_render_config_json
        if isinstance(template_version.word_render_config_json, dict)
        else {}
    )
    template_name = str(render_config.get("template_name") or "juxin_standard")
    payload = deliverable_version_payload(db, version=version, cipher=cipher)
    export_report = structured_content_export_report(payload["content"])
    output = _export_payload_content(
        db,
        version=version,
        cipher=cipher,
        watermarked=watermarked,
        payload=payload,
    )
    document = (renderer or TemplateRenderer()).render(
        title=version.title_snapshot or artifact.title,
        task_name=artifact.deliverable_type or artifact.title,
        department=actor_department or "待确认",
        author=actor_name or actor_user_id,
        output=output,
        version=f"V{version.version}.0",
        template_name=template_name,
    )
    suffix = "-未批准" if watermarked else ""
    saved = file_manager.save_docx(
        file_name=f"{version.title_snapshot or artifact.title}-V{version.version}.0{suffix}.docx",
        content=document,
    )
    try:
        export = DeliverableExport(
            deliverable_id=artifact.id,
            deliverable_version_id=version.id,
            content_hash=version.content_hash,
            export_format=body.export_format,
            status="ready",
            watermarked=watermarked,
            file_name=saved.file_name,
            file_path=saved.file_path,
            file_hash=hashlib.sha256(document).hexdigest(),
            file_size=len(document),
            renderer_version=RENDERER_VERSION,
            created_by=actor_user_id,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
            audit_request_id=request_id,
        )
        db.add(export)
        db.flush()
    except Exception:
        file_manager.delete_docx(saved.file_path)
        raise
    return DeliverableExportCreateResult(
        access=access,
        version=version,
        export=export,
        replayed=False,
        created_file_path=saved.file_path,
        export_report=export_report,
    )


def get_deliverable_export_download(
    db: Session,
    *,
    export_uuid: str,
    actor_user_id: str,
    file_manager: ExportFileManager,
) -> DeliverableExportDownloadResult:
    export = db.scalar(
        select(DeliverableExport).where(DeliverableExport.uuid == export_uuid)
    )
    artifact = (
        db.get(WorkArtifact, export.deliverable_id)
        if export is not None
        else None
    )
    if export is None or artifact is None:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_EXPORT_NOT_FOUND",
            "成果导出文件不存在",
            404,
        )
    access = get_visible_deliverable(
        db,
        deliverable_uuid=artifact.uuid,
        actor_user_id=actor_user_id,
    )
    if (
        export.status != "ready"
        or export.export_format != "docx"
        or not export.file_path
        or len(export.file_hash) != 64
        or export.file_size <= 0
    ):
        raise ProfessionalDeliveryError(
            "DELIVERABLE_EXPORT_NOT_READY",
            "成果导出文件尚不可下载",
            409,
        )
    try:
        content = file_manager.read_docx(export.file_path)
    except HTTPException as error:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_EXPORT_FILE_NOT_FOUND",
            "成果导出文件不存在",
            404,
        ) from error
    if (
        len(content) != export.file_size
        or hashlib.sha256(content).hexdigest() != export.file_hash
    ):
        raise ProfessionalDeliveryError(
            "DELIVERABLE_EXPORT_INTEGRITY_FAILED",
            "成果导出文件完整性校验失败",
            409,
        )
    return DeliverableExportDownloadResult(
        access=access,
        export=export,
        content=content,
    )


def deliverable_export_payload(
    *,
    request_id: str,
    result: DeliverableExportCreateResult,
) -> dict[str, Any]:
    export = result.export
    return {
        "request_id": request_id,
        "deliverable_uuid": result.access.artifact.uuid,
        "export_uuid": export.uuid,
        "version_uuid": result.version.uuid,
        "version_no": result.version.version,
        "content_hash": export.content_hash,
        "export_format": export.export_format,
        "status": export.status,
        "watermarked": export.watermarked,
        "file_name": export.file_name,
        "file_hash": export.file_hash,
        "file_size": export.file_size,
        "renderer_version": export.renderer_version,
        "download_url": f"/api/ai/deliverable-exports/{export.uuid}/download",
        "created_by": export.created_by,
        "created_at": export.created_at,
        "export_report": result.export_report,
    }
