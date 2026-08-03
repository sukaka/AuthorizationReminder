from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Iterable, Literal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import Settings
from .context.context_builder import RecentChatMessage
from .dashi_ppt_runtime import build_scaffolded_dashi_goal_spec, load_dashi_ppt_goal_spec
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
_PROMPT_REQUEST_MARKERS = ("提示词", "提示语", "prompt")
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
# Keep Chinese text adjacent to a theme token valid while avoiding matches inside
# longer ASCII identifiers such as `theme040`.
_THEME_PATTERN = re.compile(
    r"(?<![A-Za-z0-9_])theme\s*(0?[1-9]|1[0-2])(?![A-Za-z0-9_])",
    re.IGNORECASE,
)
_CONFIRMATION_PREFIX = "# 大师 PPT 制作前确认"
_DASHI_THEME_PREVIEW_URL = "/api/skills/dashi-ppt/theme-preview"
_AUTO_THEME_MARKERS = ("你来定", "你决定", "你定", "你帮我定", "默认风格", "随便选")
_DIRECT_START_MARKERS = ("直接生成", "直接开始", "直接制作", "马上生成", "立即生成", "直接做", "开干")
_NO_MEDIA_MARKERS = ("不需要图片", "不需要素材", "不需要视频", "无需图片", "无需素材", "无素材", "纯文字")
_NEEDS_MEDIA_MARKERS = ("需要图片", "需要素材", "需要视频", "要图片", "要素材", "带图", "加图")
_THEME_LABELS = {
    "theme01": "留白商务",
    "theme02": "科技光效",
    "theme03": "代码科技",
    "theme04": "玻璃糖果",
    "theme05": "数据图表",
    "theme06": "深色数据",
    "theme07": "冷白研究",
    "theme08": "黑金质感",
    "theme09": "深蓝杂志",
    "theme10": "金融专业",
    "theme11": "增长活力",
    "theme12": "霓虹声波",
}


class DashiPptContentError(ValueError):
    """The model reply cannot safely be turned into a user-requested deck."""


@dataclass(frozen=True)
class ChatPptContext:
    intent: PptIntent
    previous_goal: dict | None
    source_question: str
    theme_pack: str = "theme01"
    needs_media: bool = False
    requires_confirmation: bool = False


def detect_dashi_ppt_intent(question: str, *, has_previous: bool = False) -> PptIntent | None:
    normalized = "".join(str(question).casefold().split())
    if (
        not normalized
        or any(marker in normalized for marker in _INFORMATION_MARKERS)
        or any(marker in normalized for marker in _PROMPT_REQUEST_MARKERS)
    ):
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
    recent_messages: Iterable[RecentChatMessage] = (),
) -> ChatPptContext | None:
    previous_goal = _latest_chat_goal(
        db,
        settings=settings,
        user_id=user_id,
        session_uuid=session_uuid,
    )
    history = list(recent_messages)
    pending_request = _pending_confirmation_request(history)
    if pending_request is not None:
        selection = _parse_ppt_selection(question, fallback_question=pending_request)
        if selection.is_complete:
            return ChatPptContext(
                intent="create",
                previous_goal=None,
                source_question=pending_request,
                theme_pack=selection.theme_pack,
                needs_media=selection.needs_media,
            )
        return ChatPptContext(
            intent="create",
            previous_goal=None,
            source_question=pending_request,
            theme_pack=selection.theme_pack or _choose_theme_pack(pending_request),
            needs_media=bool(selection.needs_media),
            requires_confirmation=True,
        )

    intent = detect_dashi_ppt_intent(question, has_previous=previous_goal is not None)
    if intent is None:
        return None
    if intent == "revise":
        return ChatPptContext(
            intent=intent,
            previous_goal=previous_goal,
            source_question=question,
            theme_pack=_theme_pack_from_goal(previous_goal),
        )

    selection = _parse_ppt_selection(question, fallback_question=question)
    direct_start = any(marker in _normalized(question) for marker in _DIRECT_START_MARKERS)
    if selection.is_complete or direct_start:
        return ChatPptContext(
            intent=intent,
            previous_goal=None,
            source_question=question,
            theme_pack=selection.theme_pack or _choose_theme_pack(question),
            needs_media=bool(selection.needs_media),
        )
    return ChatPptContext(
        intent=intent,
        previous_goal=None,
        source_question=question,
        theme_pack=selection.theme_pack or _choose_theme_pack(question),
        needs_media=bool(selection.needs_media),
        requires_confirmation=True,
    )


@dataclass(frozen=True)
class _PptSelection:
    theme_pack: str | None = None
    needs_media: bool | None = None

    @property
    def is_complete(self) -> bool:
        return self.theme_pack is not None and self.needs_media is not None


def build_chat_ppt_confirmation_message(context: ChatPptContext) -> str:
    theme_rows = "\n".join(
        f"- `{theme}`：{label}"
        for theme, label in _THEME_LABELS.items()
    )
    return (
        f"{_CONFIRMATION_PREFIX}\n\n"
        "请先确认以下三项，确认后我就开始制作：\n"
        f"1. 主题与用途：`{_clean_text(context.source_question, limit=80)}`"
        "（如需补充受众、页数或重点，也可以一起说明）\n"
        "2. 请从下方 12 种主题预览中选择风格：\n"
        f"![大师 PPT 主题风格预览]({_DASHI_THEME_PREVIEW_URL})\n\n"
        f"{theme_rows}\n"
        "也可以回复“你来定”。\n"
        "3. 是否需要图片/视频素材：回复“需要图片”或“不需要图片”。\n\n"
        "回复示例：`主题：年度经营汇报；风格：theme05；不需要图片`"
    )


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
        "请先理解原始需求中的主题、受众、用途、必须覆盖项和禁止偏离项，再直接输出完整演示稿。"
        "你的回答必须是一个 JSON 对象，禁止代码围栏、解释或额外文本，格式如下：\n"
        '{"title":"演示标题","summary":"一句导语","slides":[{"title":"第 1 页标题","points":["要点一","要点二","要点三"]}]}'
        "\nslides 建议 5 至 10 页；每页 2 至 5 个简洁、可直接展示的要点。"
        "不得添加原始需求未支持的业务事实、数据、行动方案或通用管理话术；信息不足时使用中性表述，不要编造。"
        "演示标题不超过 36 个字，导语不超过 54 个字，页标题不超过 28 个字，每个要点不超过 36 个字，避免布局溢出。\n"
        f"已确认视觉风格：{context.theme_pack}（{_THEME_LABELS.get(context.theme_pack, '自定义主题')}）。\n"
        f"素材需求：{'需要图片或视频素材，请在适合的页面预留素材位并描述素材建议。' if context.needs_media else '不需要额外图片或视频素材，请以文字、图表和版式组织内容。'}\n"
        f"本次演示的原始需求：{_clean_text(context.source_question, limit=1200)}。"
        f"{revision_context}"
    )


def build_dashi_goal_spec(
    answer: str,
    *,
    question: str,
    theme_pack: str = "theme01",
    needs_media: bool = False,
    settings: Settings | None = None,
) -> dict:
    title, lead, sections = _parse_deck_markdown(answer, question=question)
    if theme_pack != "theme01":
        if settings is None:
            raise ValueError("非 theme01 的大师 PPT 生成需要运行时设置。")
        return build_scaffolded_dashi_goal_spec(
            settings=settings,
            title=title,
            lead=lead,
            sections=sections,
            theme_pack=theme_pack,
            needs_media=needs_media,
        )
    title_top, title_bottom = _split_title(title)
    slides: list[dict] = [{
        "layout": "theme01_page001",
        "props": {
            "kicker": _clean_text(title, limit=36),
            "titleTop": title_top,
            "titleBottom": title_bottom,
            "en": _clean_text(title, limit=36),
            "lead": lead,
            "chips": [],
            "chipCount": 0,
            "meta": [],
            "metaCount": 0,
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
            "kicker": _clean_text(sections[-1][0] if sections else title, limit=28),
            "title": _clean_text(sections[-1][0] if sections else title, limit=32),
            "en": _clean_text(sections[-1][0] if sections else title, limit=32),
            "cn": _clean_text(final_point, limit=54),
            "listLabel": _clean_text(sections[-1][0] if sections else title, limit=28),
            "sources": [],
            "panelLabel": "",
            "lead": _clean_text(final_point, limit=54),
            "meta": [],
            "disclaimer": "",
            "caption": _clean_text(title, limit=36),
            "sourceCount": 0,
            "showPanel": False,
            "showDisclaimer": False,
        },
    })
    return {"title": title, "themePack": "theme01", "slides": slides}


def _content_slide_props(
    layout: str,
    *,
    index: int,
    heading: str,
    points: list[str],
) -> dict:
    content = _slide_points(heading, points)

    def point_at(position: int) -> str:
        return content[position] if position < len(content) else ""

    common = {
        "kicker": _clean_text(heading, limit=28),
        "title": _clean_text(heading, limit=32),
        "en": _clean_text(heading, limit=32),
    }
    if layout == "theme01_page010":
        return {
            **common,
            "cn": point_at(0),
            "axisA": {
                "tag": "要点一",
                "title": point_at(1),
                "en": "POINT 01",
                "desc": point_at(2),
            },
            "axisB": {
                "tag": "要点二",
                "title": point_at(3),
                "en": "POINT 02",
                "desc": point_at(4),
            },
            "result": point_at(4),
            "crossLabel": _clean_text(heading, limit=18),
            "caption": _clean_text(heading, limit=36),
        }
    if layout in {"theme01_page011", "theme01_page013"}:
        return {
            "kicker": _clean_text(heading, limit=28),
            "partLabel": f"PART {index:02d}",
            "index": f"{index:02d}",
            "title": common["title"],
            "en": common["en"],
            "desc": point_at(0),
            "topics": [{"label": item} for item in content[1:]],
            "caption": _clean_text(heading, limit=36),
            "topicCount": max(0, len(content) - 1),
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
                    "name": "模块一",
                    "en": "PART 01",
                    "segments": [segment("要点一"), segment("要点二")],
                },
                {
                    "name": "模块二",
                    "en": "PART 02",
                    "segments": [segment("要点三"), segment("要点四")],
                },
                {
                    "name": "模块三",
                    "en": "PART 03",
                    "segments": [segment("补充一"), segment("补充二"), segment("补充三")],
                },
            ],
            "caption": _clean_text(heading, limit=36),
            "groupCount": 3,
            "itemsPerGroup": 4,
        }
    if layout == "theme01_page015":
        return {
            **common,
            "lead": point_at(0),
            "highlightWord": "重点内容",
            "bigStat": {"value": "01", "unit": "", "label": point_at(1)},
            "stats": [
                {"value": "02", "unit": "", "label": point_at(2)},
                {"value": "03", "unit": "", "label": point_at(3)},
                {"value": "04", "unit": "", "label": point_at(4)},
            ],
            "images": [],
            "caption": _clean_text(heading, limit=36),
            "imageSlotCount": 0,
            "statCount": 3,
        }
    if layout == "theme01_page009":
        return {
            "kicker": _clean_text(heading, limit=28),
            "title": _clean_text(heading, limit=32),
            "en": _clean_text(heading, limit=32),
            "cn": point_at(0),
            "chapters": [
                {
                    "no": f"{item_index:02d}",
                    "label": _clean_text(item, limit=18),
                    "en": f"POINT {item_index:02d}",
                    "desc": "",
                }
                for item_index, item in enumerate(content, start=1)
            ],
            "caption": _clean_text(heading, limit=36),
            "chapterCount": len(content),
            "highlight": True,
            "highlightIndex": 0,
            "showDesc": True,
            "showCaption": True,
        }
    if layout == "theme01_page030":
        return {
            **common,
            "cn": point_at(0),
            "lead": point_at(1),
            "highlightWord": "重点内容",
            "stats": [
                {"value": "01", "unit": "", "label": point_at(2)},
                {"value": "02", "unit": "", "label": point_at(3)},
                {"value": "03", "unit": "", "label": point_at(4)},
            ],
            "images": [],
            "caption": _clean_text(heading, limit=36),
            "imageSlotCount": 0,
            "statCount": 3,
        }
    return {
        "kicker": _clean_text(heading, limit=28),
        "value": f"{index:02d}",
        "unit": "",
        "sub": point_at(0),
        "highlightWord": "重点内容",
        "secondaries": [
            {"value": "01", "unit": "", "label": point_at(1)},
            {"value": "02", "unit": "", "label": point_at(2)},
            {"value": "03", "unit": "", "label": point_at(3)},
        ],
        "caption": point_at(4) or _clean_text(heading, limit=36),
        "secondaryCount": 3,
    }


def _slide_points(heading: str, points: list[str]) -> list[str]:
    result: list[str] = []
    seen = {_clean_text(heading, limit=36)}
    for candidate in points:
        cleaned = _clean_text(candidate, limit=36)
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
    theme_pack: str = "theme01",
    needs_media: bool = False,
) -> list[dict]:
    try:
        skill = get_default_skill_registry().get("dashi-ppt")
    except KeyError as exc:
        raise HTTPException(status_code=503, detail="DASHI_PPT_SKILL_UNAVAILABLE") from exc
    try:
        goal_spec = build_dashi_goal_spec(
            answer,
            question=question,
            theme_pack=theme_pack,
            needs_media=needs_media,
            settings=settings,
        )
    except DashiPptContentError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    result = SkillRunner(db=db, settings=settings).run(
        skill=skill,
        session=session_payload,
        task_id=f"chat:{session_uuid}",
        user_input={
            "question": question,
            "formats": ["html", "pptx"],
            "goal_spec": goal_spec,
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


def _pending_confirmation_request(messages: list[RecentChatMessage]) -> str | None:
    for index in range(len(messages) - 1, -1, -1):
        message = messages[index]
        if message.role != "assistant" or _CONFIRMATION_PREFIX not in str(message.content):
            continue
        # A later completed assistant reply means this confirmation has already
        # been consumed to create a deck; do not let it block later revisions.
        if any(item.role == "assistant" for item in messages[index + 1:]):
            continue
        for previous in reversed(messages[:index]):
            if previous.role == "user" and str(previous.content).strip():
                return str(previous.content)
    return None


def _parse_ppt_selection(question: str, *, fallback_question: str) -> _PptSelection:
    normalized = _normalized(question)
    theme_match = _THEME_PATTERN.search(question)
    theme_pack = f"theme{int(theme_match.group(1)):02d}" if theme_match else None
    if theme_pack is None and any(marker in normalized for marker in _AUTO_THEME_MARKERS):
        theme_pack = _choose_theme_pack(fallback_question)
    needs_media: bool | None = None
    if any(marker in normalized for marker in _NO_MEDIA_MARKERS):
        needs_media = False
    elif any(marker in normalized for marker in _NEEDS_MEDIA_MARKERS):
        needs_media = True
    return _PptSelection(theme_pack=theme_pack, needs_media=needs_media)


def _choose_theme_pack(question: str) -> str:
    normalized = _normalized(question)
    if any(marker in normalized for marker in ("研究", "课题", "学术", "论文")):
        return "theme07"
    if any(marker in normalized for marker in ("科技", "ai", "人工智能", "软件", "数字化")):
        return "theme02"
    if any(marker in normalized for marker in ("增长", "营销", "品牌", "市场")):
        return "theme11"
    if any(marker in normalized for marker in ("经营", "数据", "复盘", "汇报", "分析")):
        return "theme05"
    return "theme01"


def _theme_pack_from_goal(goal: dict | None) -> str:
    theme_pack = str((goal or {}).get("themePack") or "").strip()
    return theme_pack if theme_pack in _THEME_LABELS else "theme01"


def _normalized(value: object) -> str:
    return "".join(str(value or "").casefold().split())


def _parse_deck_markdown(answer: str, *, question: str) -> tuple[str, str, list[tuple[str, list[str]]]]:
    structured = _parse_deck_json(answer)
    if structured is not None:
        return structured
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
            title = _clean_text(line[2:], limit=36)
            continue
        if line.startswith("## "):
            if current_heading:
                sections.append((current_heading, current_points))
            current_heading = _clean_text(re.sub(r"^\d+[.、]\s*", "", line[3:]), limit=28)
            current_points = []
            continue
        cleaned = _clean_text(re.sub(r"^(?:[-*+]\s+|\d+[.、]\s*)", "", line), limit=36)
        if not cleaned:
            continue
        if current_heading:
            current_points.append(cleaned)
        elif len(lead_parts) < 2:
            lead_parts.append(cleaned)
    if current_heading:
        sections.append((current_heading, current_points))
    title = title or _clean_text(question, limit=36)
    lead = _clean_text(" ".join(lead_parts), limit=54)
    return _validate_deck_content(title=title, lead=lead, sections=sections)


def _parse_deck_json(answer: str) -> tuple[str, str, list[tuple[str, list[str]]]] | None:
    text = str(answer or "").strip()
    if text.startswith("```") and text.endswith("```"):
        text = re.sub(r"^```(?:json)?\\s*|\\s*```$", "", text, flags=re.IGNORECASE).strip()
    if not text.startswith("{"):
        return None
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    raw_slides = payload.get("slides")
    if not isinstance(raw_slides, list):
        raise DashiPptContentError("DASHI_PPT_CONTENT_INVALID: 模型未返回有效页面。")
    sections: list[tuple[str, list[str]]] = []
    for item in raw_slides:
        if not isinstance(item, dict):
            continue
        heading = _clean_text(item.get("title"), limit=28)
        raw_points = item.get("points")
        points = [
            _clean_text(point, limit=36)
            for point in raw_points
            if _clean_text(point, limit=36)
        ] if isinstance(raw_points, list) else []
        sections.append((heading, points))
    return _validate_deck_content(
        title=_clean_text(payload.get("title"), limit=36),
        lead=_clean_text(payload.get("summary"), limit=54),
        sections=sections,
    )


def _validate_deck_content(
    *,
    title: str,
    lead: str,
    sections: list[tuple[str, list[str]]],
) -> tuple[str, str, list[tuple[str, list[str]]]]:
    cleaned_sections: list[tuple[str, list[str]]] = []
    for heading, points in sections:
        unique_points = _slide_points(heading, points)
        if heading and unique_points:
            cleaned_sections.append((heading, unique_points))
    if not lead and cleaned_sections:
        lead = cleaned_sections[0][1][0]
    if not title or not lead or not cleaned_sections:
        raise DashiPptContentError("DASHI_PPT_CONTENT_INVALID: 模型未返回有效页面，请重新生成。")
    return title, lead, cleaned_sections


def _clean_text(value: object, *, limit: int) -> str:
    text = " ".join(str(value or "").split())
    text = text.replace("https://", "").replace("http://", "").replace("..", "…")
    return text[:limit].strip()


def _split_title(title: str) -> tuple[str, str]:
    if len(title) <= 14:
        return title, title
    middle = min(max(len(title) // 2, 8), 18)
    return title[:middle], title[middle:36] or title[:middle]


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
