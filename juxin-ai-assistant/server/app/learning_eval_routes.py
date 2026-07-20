"""Learning evaluation set API (Phase 5)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from .auth import get_session, is_platform_admin_role, require_action
from .config import Settings, get_settings
from .learning_eval import DEFAULT_EVAL_PATH, scenario_for_question
from .schemas import SessionPayload

router = APIRouter(prefix="/api/ai/learning-eval", tags=["learning-eval"])


class EvalQuestionOut(BaseModel):
    id: str
    question: str = ""
    mode: str = ""
    required_snippets: list[str] = Field(default_factory=list)
    require_web_search: bool = False


class EvalListOut(BaseModel):
    items: list[EvalQuestionOut]
    total: int
    source: str


class EvalRunIn(BaseModel):
    question_id: str = Field(min_length=1, max_length=128)
    answer: str = Field(default="", max_length=50_000)


class EvalRunOut(BaseModel):
    question_id: str
    passed: bool
    missing_snippets: list[str] = Field(default_factory=list)
    mode: str = ""
    require_web_search: bool = False


async def _require_admin(
    request: Request,
    session: SessionPayload,
    settings: Settings,
) -> None:
    if not is_platform_admin_role(session.user.role):
        raise HTTPException(status_code=403, detail="仅管理员可运行学习评测")
    await require_action("ai_assistant:admin", request, session, settings)


def _load_questions(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    if isinstance(data, list):
        return [q for q in data if isinstance(q, dict)]
    if isinstance(data, dict) and isinstance(data.get("questions"), list):
        return [q for q in data["questions"] if isinstance(q, dict)]
    return []


@router.get("/questions", response_model=EvalListOut)
async def list_eval_questions(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> EvalListOut:
    await _require_admin(request, session, settings)
    path = DEFAULT_EVAL_PATH
    raw = _load_questions(path)
    items: list[EvalQuestionOut] = []
    for row in raw:
        qid = str(row.get("id") or row.get("question_id") or "")
        if not qid:
            continue
        scenario = scenario_for_question(qid)
        items.append(
            EvalQuestionOut(
                id=qid,
                question=str(row.get("question") or row.get("text") or ""),
                mode=scenario.mode if scenario else str(row.get("mode") or ""),
                required_snippets=list(scenario.required_snippets) if scenario else [],
                require_web_search=bool(scenario.require_web_search) if scenario else False,
            )
        )
    return EvalListOut(items=items, total=len(items), source=str(path.name))


@router.post("/run", response_model=EvalRunOut)
async def run_eval_answer(
    body: EvalRunIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> EvalRunOut:
    """Score an answer against required snippets (offline / human-in-loop helper)."""
    await _require_admin(request, session, settings)
    from app.learning_eval import LearningEvalScenario

    try:
        scenario = scenario_for_question(body.question_id)
    except Exception:
        scenario = LearningEvalScenario(mode="")
    if scenario is None:
        scenario = LearningEvalScenario(mode="")
    answer = body.answer or ""
    missing = [s for s in scenario.required_snippets if s and s not in answer]
    return EvalRunOut(
        question_id=body.question_id,
        passed=not missing,
        missing_snippets=missing,
        mode=scenario.mode,
        require_web_search=scenario.require_web_search,
    )


@router.post("/ga-suite")
async def run_ga_offline_suite(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    """Run offline GA eval suite (citation / no-evidence / learning context)."""
    await _require_admin(request, session, settings)
    from .ga_offline_eval import run_ga_offline_eval

    return run_ga_offline_eval(use_synthetic=True)
