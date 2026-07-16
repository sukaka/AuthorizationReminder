"""岗位助手 / role assistant catalog surface (Phase 4 product UI data)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from .artifact_service import ArtifactService
from .auth import get_session, require_action
from .config import Settings, get_settings
from .database import get_db
from .document_templates.registry import DOCUMENT_TEMPLATES, get_document_template, list_document_templates
from .schemas import SessionPayload

router = APIRouter(prefix="/api/ai/role-assistants", tags=["role-assistants"])

CATALOG_PATH = Path(__file__).resolve().parents[1] / "catalog" / "assistants.json"

# Product-facing role assistants mapped to modes / templates
ROLE_ASSISTANTS: list[dict[str, Any]] = [
    {
        "code": "security_ops",
        "name": "安全运营助手",
        "description": "事件报告、巡检、加固与合规问答。",
        "templates": ["incident_report_v1", "risk_assessment_v1", "sop_v1"],
        "modes": ["security_ops", "knowledge"],
    },
    {
        "code": "project_pm",
        "name": "项目经理助手",
        "description": "周报、验收、会议纪要与阶段计划。",
        "templates": ["weekly_report_v1", "acceptance_report_v1", "meeting_minutes_v1", "work_plan_v1"],
        "modes": ["normal", "delivery"],
    },
    {
        "code": "presales",
        "name": "售前方案助手",
        "description": "产品能力、客户场景与方案结构。",
        "templates": ["project_report_v1", "policy_interpretation_v1"],
        "modes": ["presales", "knowledge"],
    },
    {
        "code": "business",
        "name": "商务助手",
        "description": "投标边界、响应文件与职责说明。",
        "templates": ["project_report_v1", "work_plan_v1"],
        "modes": ["business"],
    },
    {
        "code": "risk",
        "name": "风险评估助手",
        "description": "资产识别、风险等级与处置建议。",
        "templates": ["risk_assessment_v1"],
        "modes": ["risk_assessment"],
    },
    {
        "code": "knowledge",
        "name": "制度知识助手",
        "description": "制度解读与无依据拒答。",
        "templates": ["policy_interpretation_v1", "sop_v1"],
        "modes": ["knowledge"],
    },
]


class RoleAssistantOut(BaseModel):
    code: str
    name: str
    description: str
    templates: list[str] = Field(default_factory=list)
    modes: list[str] = Field(default_factory=list)


class RoleAssistantListOut(BaseModel):
    items: list[RoleAssistantOut]
    templates: list[dict[str, str]] = Field(default_factory=list)
    catalog_assistants: int = 0


class RoleGenerateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    template_code: str = Field(default="", max_length=64)
    title: str = Field(default="", max_length=255)
    topic: str = Field(default="", max_length=2000)
    notes: str = Field(default="", max_length=10_000)
    create_artifact: bool = True
    polish_with_model: bool | None = None  # None = follow feature flag


class RoleGenerateOut(BaseModel):
    role_code: str
    template_code: str
    template_name: str
    title: str
    content_markdown: str
    artifact_id: str = ""
    polished: bool = False
    polish_mode: str = "skeleton"  # skeleton | model | model_failed


def _role_by_code(code: str) -> dict[str, Any] | None:
    for row in ROLE_ASSISTANTS:
        if row["code"] == code:
            return row
    return None


def build_role_document(
    *,
    role: dict[str, Any],
    template_code: str,
    title: str,
    topic: str,
    notes: str,
) -> tuple[str, str, str, str]:
    """Return (template_code, template_name, title, markdown)."""
    templates = list(role.get("templates") or [])
    code = template_code or (templates[0] if templates else "generic_v1")
    if code not in DOCUMENT_TEMPLATES and code not in templates:
        # allow generic fallback
        if code not in DOCUMENT_TEMPLATES:
            code = templates[0] if templates else "generic_v1"
    tmpl = get_document_template(code)
    doc_title = (title or f"{role['name']} · {tmpl.name}").strip()
    topic_line = (topic or "（待补充主题）").strip()
    notes_block = (notes or "").strip()

    sections: list[str] = [f"# {doc_title}", "", f"> 岗位助手：{role['name']}", f"> 主题：{topic_line}", ""]
    for heading in tmpl.fixed_headings:
        body = "待确认"
        if notes_block and heading in {"背景说明", "事件概述", "项目背景", "本周工作概述", "制度名称与版本", "目的"}:
            body = notes_block
        elif heading in {"基本信息", "会议基本信息", "项目基本信息", "评估对象与范围"}:
            body = f"- 主题：{topic_line}\n- 编制：岗位助手自动草稿\n- 状态：待人工复核"
        sections.append(f"# {heading}\n\n{body}\n")
    raw = "\n".join(sections).strip()
    normalized = tmpl.normalize_output(raw)
    return code, tmpl.name, doc_title, normalized


async def polish_role_document(
    *,
    settings: Settings,
    role_name: str,
    template_name: str,
    title: str,
    topic: str,
    notes: str,
    skeleton: str,
) -> tuple[str, str]:
    """Return (markdown, polish_mode). Falls back to skeleton when model unavailable."""
    from .feature_flags import load_feature_flags
    from .model_gateway import ModelInvocation, SettingsModelGateway
    from .server_model_client import is_server_model_configured

    flags = load_feature_flags(settings)
    if not flags.get("role_assistant_model_polish", True):
        return skeleton, "skeleton"
    if not is_server_model_configured(settings):
        return skeleton, "skeleton"
    gateway = SettingsModelGateway(settings)
    if not gateway.is_ready():
        return skeleton, "skeleton"
    system = (
        "你是企业正式文档助手。请在保留全部一级标题结构的前提下，"
        "把草稿润色为可提交复核的中文 Markdown 正文。"
        "不得删除标题；不确定处写「待确认」；不得编造制度条款或数据。"
        "输出完整 Markdown，不要解释过程。"
    )
    user = (
        f"岗位：{role_name}\n模板：{template_name}\n标题：{title}\n"
        f"主题：{topic}\n补充：{notes or '（无）'}\n\n草稿：\n{skeleton}"
    )
    try:
        result = await gateway.complete(
            ModelInvocation(
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=0.2,
                purpose="role_assistant_polish",
            )
        )
        output = (result.output or "").strip()
        if not output or len(output) < 40:
            return skeleton, "model_failed"
        # keep template structure if model dropped headings
        from .document_templates.registry import get_document_template

        return output, "model"
    except Exception:
        return skeleton, "model_failed"


@router.get("", response_model=RoleAssistantListOut)
async def list_role_assistants(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> RoleAssistantListOut:
    await require_action("ai_assistant:use", request, session, settings)
    catalog_count = 0
    if CATALOG_PATH.exists():
        try:
            data = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("assistants"), list):
                catalog_count = len(data["assistants"])
            elif isinstance(data, list):
                catalog_count = len(data)
        except Exception:
            catalog_count = 0
    return RoleAssistantListOut(
        items=[RoleAssistantOut(**row) for row in ROLE_ASSISTANTS],
        templates=list_document_templates(),
        catalog_assistants=catalog_count,
    )


@router.post("/{role_code}/generate", response_model=RoleGenerateOut)
async def generate_role_document(
    role_code: str,
    body: RoleGenerateIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> RoleGenerateOut:
    """One-click draft from role assistant + enterprise template; optional artifact."""
    await require_action("ai_assistant:use", request, session, settings)
    role = _role_by_code(role_code)
    if role is None:
        raise HTTPException(status_code=404, detail="role_not_found")
    code, name, title, skeleton = build_role_document(
        role=role,
        template_code=body.template_code,
        title=body.title,
        topic=body.topic,
        notes=body.notes,
    )
    want_polish = body.polish_with_model
    if want_polish is None:
        from .feature_flags import load_feature_flags

        want_polish = bool(load_feature_flags(settings).get("role_assistant_model_polish", True))
    polish_mode = "skeleton"
    markdown = skeleton
    if want_polish:
        markdown, polish_mode = await polish_role_document(
            settings=settings,
            role_name=str(role["name"]),
            template_name=name,
            title=title,
            topic=body.topic,
            notes=body.notes,
            skeleton=skeleton,
        )
        # re-normalize headings against template
        tmpl = get_document_template(code)
        markdown = tmpl.normalize_output(markdown)
    artifact_id = ""
    if body.create_artifact:
        row = ArtifactService(db).create_from_run(
            owner_user_id=str(session.user.id),
            run_id="",
            title=title,
            content_markdown=markdown,
            artifact_type="markdown",
            quality={
                "source": "role_assistant",
                "role": role_code,
                "template": code,
                "polish_mode": polish_mode,
            },
            actor=str(session.user.id),
        )
        db.commit()
        artifact_id = row.uuid
    return RoleGenerateOut(
        role_code=role_code,
        template_code=code,
        template_name=name,
        title=title,
        content_markdown=markdown,
        artifact_id=artifact_id,
        polished=polish_mode == "model",
        polish_mode=polish_mode,
    )
