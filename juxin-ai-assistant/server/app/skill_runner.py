from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .agent_runtime import ToolContext, ToolRegistry
from .agent_runtime.tools import PersonalMemoryTool
from .auth import is_platform_admin_role
from .config import Settings, get_settings
from .dashi_ppt_runtime import DashiPptRuntimeError, generate_dashi_ppt
from .models import SkillRunLog
from .schemas import SessionPayload
from .skill_definition import SkillDefinition


TOOL_ALIASES = {
    "file_parser": "file_parse",
    "knowledge_retrieval": "company_knowledge_search",
    "document_generator": "word_export",
    "personal_memory": "personal_memory",
    "table_generator": "pptx_export",
}


def _utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _normalize_tool_name(name: str) -> str:
    return TOOL_ALIASES.get(name, name)


def _attachments(payload: dict[str, Any]) -> list[dict[str, Any]]:
    value = payload.get("attachments") or []
    return [item for item in value if isinstance(item, dict)]


def _input_summary(payload: dict[str, Any]) -> dict[str, Any]:
    attachments = _attachments(payload)
    return {
        "question_length": len(str(payload.get("question") or payload.get("description") or "")),
        "attachment_count": len(attachments),
        "attachment_types": [str(item.get("file_type") or "").lower() for item in attachments][:20],
    }


class SkillRunner:
    def __init__(self, *, db: Session, settings: Settings | None = None) -> None:
        self.db = db
        self.settings = settings or get_settings()

    def run(
        self,
        *,
        skill: SkillDefinition,
        session: SessionPayload,
        task_id: str,
        user_input: dict[str, Any],
    ) -> dict[str, Any]:
        self._ensure_user_can_run(skill, session)
        self._validate_input(skill, user_input)
        started = _utc_now()
        log = SkillRunLog(
            skill_id=skill.id,
            skill_version=skill.version,
            task_id=task_id,
            user_id=str(session.user.id),
            status="running",
            tools_used_json=[],
            input_summary_json=_input_summary(user_input),
            output_summary_json={},
            started_at=started,
        )
        self.db.add(log)
        self.db.flush()
        try:
            tools_used = self._run_allowed_tools(skill, session, user_input, run_id=log.uuid)
            summary = self._build_summary(skill, user_input)
            if skill.id == "dashi-ppt":
                title, exported = generate_dashi_ppt(
                    settings=self.settings,
                    user_id=str(session.user.id),
                    run_id=log.uuid,
                    question=str(user_input.get("question") or ""),
                    user_input=user_input,
                )
                summary = f"已完成{title}：已生成可编辑 HTML 和真实演示文稿文件。"
                artifacts = [
                    {"kind": "markdown", "title": skill.name, "content": summary},
                    *[artifact.as_dict(run_id=log.uuid) for artifact in exported],
                ]
            else:
                artifacts = self._build_artifacts(skill, summary)
            log.status = "completed"
            log.tools_used_json = tools_used
            log.output_summary_json = {
                "artifact_count": len(artifacts),
                "output_types": skill.manifest.output_types,
            }
            log.finished_at = _utc_now()
            self.db.commit()
            self.db.refresh(log)
            return {
                "run_id": log.uuid,
                "skill_id": skill.id,
                "skill_version": skill.version,
                "status": log.status,
                "tools_used": tools_used,
                "result": {"summary": summary},
                "artifacts": artifacts,
            }
        except DashiPptRuntimeError as exc:
            log.status = "failed"
            log.error_message = str(exc)[:500]
            log.finished_at = _utc_now()
            self.db.commit()
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except Exception as exc:
            log.status = "failed"
            log.error_message = str(exc)[:500]
            log.finished_at = _utc_now()
            self.db.commit()
            raise

    def _ensure_user_can_run(self, skill: SkillDefinition, session: SessionPayload) -> None:
        if skill.status != "published" and session.user.role.strip().lower() != "admin":
            raise HTTPException(status_code=404, detail="SKILL_NOT_FOUND")

    def _validate_input(self, skill: SkillDefinition, user_input: dict[str, Any]) -> None:
        attachments = _attachments(user_input)
        if skill.requires_attachment and not attachments:
            raise HTTPException(status_code=400, detail="SKILL_ATTACHMENT_REQUIRED")
        allowed_types = {item.lower() for item in skill.manifest.input_types}
        for item in attachments:
            file_type = str(item.get("file_type") or item.get("type") or "").lower().lstrip(".")
            if file_type and file_type not in allowed_types:
                raise HTTPException(status_code=400, detail="SKILL_INPUT_TYPE_NOT_ALLOWED")
        if not skill.permissions.allow_web and any(
            _normalize_tool_name(tool).startswith("web_") for tool in skill.allowed_tools
        ):
            raise HTTPException(status_code=400, detail="SKILL_WEB_NOT_ALLOWED")

    def _run_allowed_tools(
        self,
        skill: SkillDefinition,
        session: SessionPayload,
        user_input: dict[str, Any],
        *,
        run_id: str,
    ) -> list[str]:
        normalized_allowed = {_normalize_tool_name(tool) for tool in skill.allowed_tools}
        registry = ToolRegistry()
        if "personal_memory" in normalized_allowed:
            registry.register(PersonalMemoryTool())
            registry.execute(
                "personal_memory",
                {"action": "list", "limit": 5},
                ToolContext(
                    user_id=str(session.user.id),
                    db=self.db,
                    permissions={"ai_assistant:admin"} if session.user.role == "admin" else set(),
                    run_id=run_id,
                    mode="skill",
                ),
            )
            return ["personal_memory"]
        return []

    def _build_summary(self, skill: SkillDefinition, user_input: dict[str, Any]) -> str:
        if skill.id == "risk-assessment-review":
            return "已完成风险评估过程文档审查：输出不符合项、证据缺口、修改建议，并准备 Word 报告。"
        if skill.id == "incident-report":
            return "已生成安全事件分析报告：包含事件经过、处置过程、原因分析和整改建议。"
        if skill.id == "tool-update-record":
            return "已整理工具更新记录：包含更新时间范围、工具清单、变更说明和交付记录。"
        question = str(user_input.get("question") or "能力运行")
        return f"已完成{skill.name}：{question[:80]}"

    def _build_artifacts(self, skill: SkillDefinition, summary: str) -> list[dict[str, Any]]:
        artifacts: list[dict[str, Any]] = [{"kind": "markdown", "title": skill.name, "content": summary}]
        if "docx" in skill.manifest.output_types:
            artifacts.append({"kind": "docx", "title": f"{skill.name}.docx", "content": summary})
        if "xlsx" in skill.manifest.output_types:
            artifacts.append({"kind": "xlsx", "title": f"{skill.name}.xlsx", "content": summary})
        return artifacts
