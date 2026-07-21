from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Literal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import Settings
from .dashi_ppt_runtime import load_dashi_ppt_goal_spec
from .models import SkillRunLog
from .schemas import SessionPayload
from .skill_registry import get_default_skill_registry
from .skill_runner import SkillRunner


PptIntent = Literal["create", "revise"]

_PPT_NOUNS = ("ppt", "pptx", "powerpoint", "幻灯片", "演示文稿", "汇报材料")
_CREATE_ACTIONS = ("生成", "制作", "创建", "做一份", "做个", "帮我做", "出一份", "输出", "导出")
_REVISE_ACTIONS = ("调整", "修改", "改成", "改为", "替换", "增加", "新增", "删除", "重做", "优化", "换成")
_REVISION_REFERENCES = ("上一版", "上一个", "刚才", "这份", "那个", "原来的", "前一版")
_INFORMATION_MARKERS = ("什么是", "是什么意思", "如何制作", "怎么制作", "制作方法", "教程", "为什么")
_SLIDE_REFERENCE_PATTERN = re.compile(r"(?:第?[一二三四五六七八九十百零两\d]+页|封面|目录页|结尾页|最后一页)")
_CONTENT_LAYOUTS = (
    "theme01_page010",
    "theme01_page011",
    "theme01_page013",
    "theme01_page014",
    "theme01_page015",
    "theme01_page009",
    "theme01_page030",
    "theme01_page006",
)


@dataclass(frozen=True)
class ChatPptContext:
    intent: PptIntent
    previous_goal: dict | None


def detect_dashi_ppt_intent(question: str, *, has_previous: bool = False) -> PptIntent | None:
    normalized = "".join(str(question).casefold().split())
    if not normalized or any(marker in normalized for marker in _INFORMATION_MARKERS):
        return None
    has_deck_noun = any(noun in normalized for noun in _PPT_NOUNS)
    has_revision_action = any(action in normalized for action in _REVISE_ACTIONS)
    references_previous = any(marker in normalized for marker in _REVISION_REFERENCES)
    references_slide = bool(_SLIDE_REFERENCE_PATTERN.search(normalized))
    if has_revision_action and (has_deck_noun or references_previous or (has_previous and references_slide)):
        return "revise" if has_previous else None
    if has_deck_noun and any(action in normalized for action in _CREATE_ACTIONS):
        return "create"
    return None


def resolve_chat_ppt_context(
    db: Session,
    *,
    settings: Settings,
    user_id: str,
    session_uuid: str,
    question: str,
) -> ChatPptContext | None:
    previous_goal = _latest_chat_goal(
        db,
        settings=settings,
        user_id=user_id,
        session_uuid=session_uuid,
    )
    intent = detect_dashi_ppt_intent(question, has_previous=previous_goal is not None)
    if intent is None:
        return None
    return ChatPptContext(intent=intent, previous_goal=previous_goal)


def build_chat_ppt_system_message(context: ChatPptContext) -> str:
    revision_context = ""
    if context.intent == "revise" and context.previous_goal:
        previous = _prompt_safe_previous_goal(context.previous_goal)
        revision_context = (
            "\n这是当前聊天中上一版演示稿的结构。请按用户要求修改，并输出修改后的完整版本，"
            "不能只给变更说明：\n"
            f"{json.dumps(previous, ensure_ascii=False, separators=(',', ':'))}\n"
        )
    return (
        "你正在执行 Dashi PPT（大师 PPT）演示文稿任务。服务器会在你的回答完成后，"
        "调用 Dashi PPT 运行时及 html-deck-to-pptx 导出引擎生成可编辑 HTML 和真实 PPTX 文件。"
        "不得回答‘不能生成 PPTX’、‘只能提供大纲’或要求用户手动选择 Skill。\n"
        "请直接给出完整演示稿，严格使用以下 Markdown 结构：\n"
        "# 演示标题\n一句简短导语\n## 第 1 页标题\n- 要点一\n- 要点二\n"
        "## 第 2 页标题\n- 要点一\n- 要点二\n"
        "正文建议 5 至 10 页；每页 2 至 5 个简洁、可直接展示的要点。"
        "不要输出代码围栏，不要只输出制作建议。"
        f"{revision_context}"
    )


def build_dashi_goal_spec(
    answer: str,
    *,
    question: str,
) -> dict:
    title, lead, sections = _parse_deck_markdown(answer, question=question)
    title_top, title_bottom = _split_title(title)
    slides: list[dict] = [{
        "layout": "theme01_page001",
        "props": {
            "kicker": "聚信 AI 助手 · 大师 PPT",
            "titleTop": title_top,
            "titleBottom": title_bottom,
            "en": "JUXIN AI PRESENTATION",
            "lead": lead,
            "chips": ["自动生成", "可继续调整", "PPTX 交付"],
            "meta": [
                {"label": "生成方式", "value": "聚信 AI 助手"},
                {"label": "编辑能力", "value": "HTML 可调整"},
                {"label": "交付格式", "value": "PPTX"},
            ],
        },
    }]
    for index, (heading, points) in enumerate(sections[:len(_CONTENT_LAYOUTS)], start=1):
        layout = _CONTENT_LAYOUTS[index - 1]
        slides.append({
            "layout": layout,
            "props": _content_slide_props(layout, index=index, heading=heading, points=points),
        })
    final_point = sections[-1][1][-1] if sections and sections[-1][1] else lead
    slides.append({
        "layout": "theme01_page084",
        "props": {
            "kicker": "总结",
            "title": "结论与下一步",
            "en": "CONCLUSION & NEXT STEPS",
            "cn": _clean_text(final_point, limit=54),
            "listLabel": "交付说明 · DELIVERY",
            "sources": [],
            "panelLabel": "版本与调整 · REVISION",
            "lead": "以上内容可在当前聊天中继续提出修改要求，系统会保留旧版并生成新版本。",
            "meta": [
                {"k": "演示主题", "v": _clean_text(title, limit=32)},
                {"k": "可编辑版本", "v": "HTML"},
                {"k": "正式交付", "v": "PPTX"},
            ],
            "disclaimer": "内容由 AI 辅助生成，正式使用前请结合实际数据复核。",
            "caption": "聚信 AI 助手 · 支持在聊天中继续修改",
            "sourceCount": 0,
            "showPanel": True,
            "showDisclaimer": True,
        },
    })
    return {"title": title, "slides": slides}


def _content_slide_props(
    layout: str,
    *,
    index: int,
    heading: str,
    points: list[str],
) -> dict:
    content = _slide_points(heading, points)
    common = {
        "kicker": f"{index:02d} / 核心内容",
        "title": _clean_text(heading, limit=32),
        "en": f"SECTION {index:02d}",
    }
    if layout == "theme01_page010":
        return {
            **common,
            "cn": content[0],
            "axisA": {
                "tag": "核心判断",
                "title": content[1],
                "en": "KEY INSIGHT",
                "desc": content[2],
            },
            "axisB": {
                "tag": "行动建议",
                "title": content[3],
                "en": "NEXT ACTION",
                "desc": content[4],
            },
            "result": f"形成第 {index} 页行动闭环",
            "crossLabel": "判断 × 行动",
            "caption": f"第 {index} 页聚焦关键判断与执行路径",
        }
    if layout in {"theme01_page011", "theme01_page013"}:
        return {
            "kicker": "章节要点",
            "partLabel": f"PART {index:02d}",
            "index": f"{index:02d}",
            "title": common["title"],
            "en": common["en"],
            "desc": content[0],
            "topics": [{"label": item} for item in content[1:]],
            "caption": f"第 {index} 章 · 重点内容导航",
            "topicCount": 4,
            "imageSlotCount": 0,
            "images": [],
        }
    if layout == "theme01_page014":
        segment_index = 0

        def segment(label: str) -> dict:
            nonlocal segment_index
            current = segment_index
            segment_index += 1
            return {
                "label": label,
                "items": [
                    f"{_clean_text(content[(current + offset) % len(content)], limit=11)} · {current + 1}.{offset + 1}"
                    for offset in range(4)
                ],
            }

        return {
            **common,
            "cn": content[0],
            "layers": [
                {
                    "name": "目标层",
                    "en": "GOAL",
                    "segments": [segment("核心判断"), segment("成果标准")],
                },
                {
                    "name": "执行层",
                    "en": "ACTION",
                    "segments": [segment("责任分工"), segment("实施节奏")],
                },
                {
                    "name": "验证层",
                    "en": "VERIFY",
                    "segments": [segment("过程检查"), segment("风险响应"), segment("复盘沉淀")],
                },
            ],
            "caption": f"第 {index} 页 · 从目标到验证形成完整链路",
            "groupCount": 3,
            "itemsPerGroup": 4,
        }
    if layout == "theme01_page015":
        return {
            **common,
            "lead": content[0],
            "highlightWord": "执行重点",
            "bigStat": {"value": "01", "unit": "项", "label": content[1]},
            "stats": [
                {"value": "02", "unit": "项", "label": content[2]},
                {"value": "03", "unit": "项", "label": content[3]},
                {"value": "04", "unit": "项", "label": content[4]},
            ],
            "images": [],
            "caption": f"第 {index} 页 · 四项执行抓手",
            "imageSlotCount": 0,
            "statCount": 3,
        }
    if layout == "theme01_page009":
        return {
            "kicker": "# 报告导览",
            "title": f"第 {index} 部分 · 内容导览",
            "en": f"SECTION {index:02d} CONTENTS",
            "cn": content[0],
            "chapters": [
                {
                    "no": f"{item_index:02d}",
                    "label": _clean_text(item, limit=18),
                    "en": f"FOCUS {item_index:02d}",
                    "desc": f"第 {item_index} 项重点及其落地要求",
                }
                for item_index, item in enumerate(content, start=1)
            ],
            "caption": f"第 {index} 页 · 五项重点一览",
            "chapterCount": 5,
            "highlight": True,
            "highlightIndex": 0,
            "showDesc": True,
            "showCaption": True,
        }
    if layout == "theme01_page030":
        return {
            **common,
            "cn": content[0],
            "lead": content[1],
            "highlightWord": "落地执行",
            "stats": [
                {"value": "01", "unit": "项", "label": content[2]},
                {"value": "02", "unit": "项", "label": content[3]},
                {"value": "03", "unit": "项", "label": content[4]},
            ],
            "images": [],
            "caption": f"第 {index} 页 · 从判断走向实施",
            "imageSlotCount": 0,
            "statCount": 3,
        }
    return {
        "kicker": f"第 {index} 页 · 关键结论",
        "value": f"{index:02d}",
        "unit": "项主题",
        "sub": content[0],
        "highlightWord": "关键结论",
        "secondaries": [
            {"value": "01", "unit": "项", "label": content[1]},
            {"value": "02", "unit": "项", "label": content[2]},
            {"value": "03", "unit": "项", "label": content[3]},
        ],
        "caption": content[4],
        "secondaryCount": 3,
    }


def _slide_points(heading: str, points: list[str]) -> list[str]:
    candidates = [
        *points,
        f"明确本页主题的核心目标与预期结果",
        f"围绕业务场景识别关键判断依据",
        f"将重点任务落实到责任人与执行节奏",
        f"通过阶段成果持续验证实施效果",
        f"沉淀可复用的方法并形成后续闭环",
    ]
    result: list[str] = []
    seen = {_clean_text(heading, limit=64)}
    for candidate in candidates:
        cleaned = _clean_text(candidate, limit=64)
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        result.append(cleaned)
        if len(result) == 5:
            break
    return result


def run_chat_dashi_ppt(
    db: Session,
    *,
    settings: Settings,
    session_payload: SessionPayload,
    session_uuid: str,
    question: str,
    answer: str,
) -> list[dict]:
    try:
        skill = get_default_skill_registry().get("dashi-ppt")
    except KeyError as exc:
        raise HTTPException(status_code=503, detail="DASHI_PPT_SKILL_UNAVAILABLE") from exc
    result = SkillRunner(db=db, settings=settings).run(
        skill=skill,
        session=session_payload,
        task_id=f"chat:{session_uuid}",
        user_input={
            "question": question,
            "formats": ["html", "pptx"],
            "goal_spec": build_dashi_goal_spec(answer, question=question),
        },
    )
    run_id = str(result["run_id"])
    generated_files: list[dict] = []
    for artifact in result.get("artifacts", []):
        artifact_format = str(artifact.get("kind") or "")
        if artifact_format not in {"html", "pptx"}:
            continue
        generated_files.append({
            "artifact_id": f"dashi-ppt:{run_id}:{artifact_format}",
            "file_name": str(artifact.get("file_name") or f"presentation.{artifact_format}"),
            "format": artifact_format,
            "media_type": str(artifact.get("mime_type") or "application/octet-stream"),
            "download_url": str(artifact.get("download_url") or ""),
        })
    if {item["format"] for item in generated_files} != {"html", "pptx"}:
        raise HTTPException(status_code=503, detail="DASHI_PPT_OUTPUT_INCOMPLETE")
    return generated_files


def _latest_chat_goal(
    db: Session,
    *,
    settings: Settings,
    user_id: str,
    session_uuid: str,
) -> dict | None:
    row = db.scalar(
        select(SkillRunLog)
        .where(
            SkillRunLog.skill_id == "dashi-ppt",
            SkillRunLog.task_id == f"chat:{session_uuid}",
            SkillRunLog.user_id == user_id,
            SkillRunLog.status == "completed",
        )
        .order_by(SkillRunLog.id.desc())
        .limit(1)
    )
    if row is None:
        return None
    return load_dashi_ppt_goal_spec(settings, user_id=user_id, run_id=row.uuid)


def _parse_deck_markdown(answer: str, *, question: str) -> tuple[str, str, list[tuple[str, list[str]]]]:
    lines = [line.strip() for line in str(answer).splitlines()]
    title = ""
    lead_parts: list[str] = []
    sections: list[tuple[str, list[str]]] = []
    current_heading = ""
    current_points: list[str] = []
    for line in lines:
        if not line or line.startswith("```"):
            continue
        if line.startswith("# ") and not title:
            title = _clean_text(line[2:], limit=80)
            continue
        if line.startswith("## "):
            if current_heading:
                sections.append((current_heading, current_points))
            current_heading = _clean_text(re.sub(r"^\d+[.、]\s*", "", line[3:]), limit=48)
            current_points = []
            continue
        cleaned = _clean_text(re.sub(r"^(?:[-*+]\s+|\d+[.、]\s*)", "", line), limit=120)
        if not cleaned:
            continue
        if current_heading:
            current_points.append(cleaned)
        elif len(lead_parts) < 2:
            lead_parts.append(cleaned)
    if current_heading:
        sections.append((current_heading, current_points))
    title = title or _clean_text(question, limit=80) or "专题汇报"
    lead = _clean_text(" ".join(lead_parts), limit=180) or "围绕目标、关键判断与下一步行动形成完整汇报。"
    if not sections:
        fallback_points = [
            _clean_text(item, limit=120)
            for item in re.split(r"[。；\n]+", str(answer))
            if _clean_text(item, limit=120)
        ][:5]
        sections = [("核心内容", fallback_points or [lead])]
    return title, lead, sections


def _clean_text(value: object, *, limit: int) -> str:
    text = " ".join(str(value or "").split())
    text = text.replace("https://", "").replace("http://", "").replace("..", "…")
    return text[:limit].strip()


def _split_title(title: str) -> tuple[str, str]:
    if len(title) <= 14:
        return title, "专题汇报"
    middle = min(max(len(title) // 2, 8), 18)
    return title[:middle], title[middle:36] or "专题汇报"


def _prompt_safe_previous_goal(goal: dict) -> dict:
    slides = []
    for item in list(goal.get("slides") or [])[:12]:
        props = item.get("props") if isinstance(item, dict) else {}
        slides.append({
            "layout": str(item.get("layout") or ""),
            "props": props if isinstance(props, dict) else {},
        })
    return {
        "title": str(goal.get("title") or "")[:100],
        "slides": slides,
    }
