from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from xml.etree import ElementTree
from zipfile import ZipFile


WORD_NAMESPACE = (
    "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
)
W = f"{{{WORD_NAMESPACE}}}"

NON_TASK_TITLE_FRAGMENTS = {
    "手册定位",
    "使用原则",
    "使用规范",
    "使用方法",
    "结束语",
    "输入模板",
    "输出格式引用说明",
    "注意事项",
    "使用场景",
}
INDEPENDENT_CHECK_TASKS = {
    "技术标书自查提示词",
    "标书用印流程与盖章检查清单",
    "检查测试用例是否合格",
    "商务全流程风险检查清单",
    "文档遗漏检查",
}
KNOWLEDGE_TITLES = {"公司知识库"}
QUALITY_RULE_TITLES = {"统一输出质量规则"}

BUSINESS_SECTIONS = {
    "第四部分": "销售",
    "第五部分": "售前",
    "第六部分": "产品交付与实施",
    "第七部分": "软件测试",
    "第八部分": "行政与人力",
    "第九部分": "商务与投标支持",
    "第十部分": "渗透测试与安全服务",
}

FIELD_KEY_BY_LABEL = {
    "客户名称": "customer_name",
    "客户沟通记录": "communication_record",
    "客户名单": "customer_list",
    "客户背景": "customer_background",
    "客户需求": "customer_requirements",
    "项目名称": "project_name",
    "项目背景": "project_background",
    "项目需求": "project_requirements",
    "产品名称": "product_name",
    "产品信息": "product_information",
    "方案内容": "solution_content",
    "招标文件": "tender_document",
    "投标文件": "bid_document",
    "技术标书": "technical_proposal",
    "商务标书": "commercial_proposal",
    "测试用例": "test_cases",
    "测试结果": "test_results",
    "岗位名称": "job_title",
    "岗位要求": "job_requirements",
    "候选人信息": "candidate_information",
    "合同内容": "contract_content",
    "文档内容": "document_content",
    "沟通目标": "communication_goal",
    "时间范围": "time_range",
}

PLACEHOLDER_PATTERN = re.compile(
    r"(?P<label>[\u4e00-\u9fffA-Za-z0-9（）()、/]+)"
    r"(?P<separator>[：:])"
    r"(?P<placeholder>\[[^\]\n]+\])"
)


@dataclass(frozen=True)
class Paragraph:
    style: str
    text: str


def read_paragraphs(path: str | Path) -> list[Paragraph]:
    with ZipFile(path) as document:
        xml = document.read("word/document.xml")
    root = ElementTree.fromstring(xml)
    paragraphs: list[Paragraph] = []
    for node in root.iter(f"{W}p"):
        style_node = node.find(f"./{W}pPr/{W}pStyle")
        style = (
            style_node.attrib.get(f"{W}val", "")
            if style_node is not None
            else ""
        )
        text = "".join(
            value.text or "" for value in node.iter(f"{W}t")
        )
        if text:
            paragraphs.append(Paragraph(style=style, text=text))
    return paragraphs


def classify_candidate(title: str) -> str:
    normalized = title.strip()
    if normalized in INDEPENDENT_CHECK_TASKS:
        return "TASK"
    if any(
        fragment in normalized
        for fragment in NON_TASK_TITLE_FRAGMENTS
    ):
        return "EXCLUDED"
    if normalized in KNOWLEDGE_TITLES:
        return "KNOWLEDGE"
    if normalized in QUALITY_RULE_TITLES:
        return "QUALITY_RULE"
    return "TASK"


def _field_label(raw_label: str) -> str:
    return raw_label.removeprefix("以下是").strip()


def _extract_fields(
    prompt: str,
) -> tuple[str, list[dict[str, Any]], list[dict[str, str]]]:
    fields: list[dict[str, Any]] = []
    unresolved: list[dict[str, str]] = []
    seen_fields: set[str] = set()
    seen_unresolved: set[tuple[str, str]] = set()

    def replace(match: re.Match[str]) -> str:
        raw_label = match.group("label")
        label = _field_label(raw_label)
        placeholder = match.group("placeholder")
        field_key = FIELD_KEY_BY_LABEL.get(label)
        if field_key is None:
            unresolved_key = (label, placeholder)
            if unresolved_key not in seen_unresolved:
                seen_unresolved.add(unresolved_key)
                unresolved.append(
                    {"label": label, "placeholder": placeholder}
                )
            return match.group(0)
        if field_key not in seen_fields:
            seen_fields.add(field_key)
            fields.append(
                {
                    "field_key": field_key,
                    "label": label,
                    "field_type": "TEXT",
                    "required": True,
                    "placeholder": placeholder,
                    "example": "",
                    "options_json": [],
                    "validation_json": {},
                    "sort_order": len(fields) * 10 + 10,
                }
            )
        return (
            f"{raw_label}{match.group('separator')}"
            f"{{{{{field_key}}}}}"
        )

    return PLACEHOLDER_PATTERN.sub(replace, prompt), fields, unresolved


def _section_name(heading: str) -> str | None:
    normalized = re.sub(r"\s+", "", heading)
    return next(
        (
            section
            for prefix, section in BUSINESS_SECTIONS.items()
            if normalized.startswith(prefix)
        ),
        None,
    )


def _governance(paragraphs: list[Paragraph]) -> dict[str, str]:
    title = "聚信得仁公司级统一输出总控要求"
    content: list[str] = []
    collecting = False
    for paragraph in paragraphs:
        text = paragraph.text.strip()
        if paragraph.style == "Heading2" and text == title:
            collecting = True
            continue
        if collecting and paragraph.style in {"Heading1", "Heading2"}:
            break
        if collecting:
            content.append(paragraph.text)
    return {"title": title, "content": "\n".join(content)}


def compile_manual(
    path: str | Path,
    source_version: str,
) -> dict[str, Any]:
    source_path = Path(path)
    paragraphs = read_paragraphs(source_path)
    entries: list[dict[str, Any]] = []
    section: str | None = None
    category = ""
    candidate: dict[str, Any] | None = None
    prompt_part: str | None = None

    def finish_candidate() -> None:
        nonlocal candidate
        if candidate is None:
            return
        classification = classify_candidate(candidate["source_title"])
        if classification != "EXCLUDED":
            prompt = "\n".join(candidate.pop("_prompt_parts"))
            scene = "\n".join(candidate.pop("_scene_parts"))
            prompt, fields, unresolved = _extract_fields(prompt)
            candidate.update(
                {
                    "scene": scene,
                    "prompt": prompt,
                    "classification": classification,
                    "fields": fields,
                    "unresolved": unresolved,
                }
            )
            entries.append(candidate)
        candidate = None

    for paragraph in paragraphs:
        text = paragraph.text.strip()
        if paragraph.style == "Heading1":
            finish_candidate()
            section = _section_name(text)
            category = ""
            prompt_part = None
            continue
        if section is None:
            continue
        if paragraph.style == "Heading2":
            finish_candidate()
            category = text
            prompt_part = None
            if section == "售前" and text.endswith("提示词"):
                candidate = {
                    "section": section,
                    "category": text,
                    "source_title": text,
                    "_scene_parts": [],
                    "_prompt_parts": [],
                }
            continue
        if paragraph.style == "Heading3":
            finish_candidate()
            prompt_part = None
            candidate = {
                "section": section,
                "category": category,
                "source_title": text,
                "_scene_parts": [],
                "_prompt_parts": [],
            }
            continue
        if candidate is None:
            continue
        if paragraph.style == "Prompt标题":
            prompt_part = {
                "使用场景": "scene",
                "提示词": "prompt",
            }.get(text)
            continue
        if paragraph.style != "Prompt正文":
            continue
        if prompt_part == "scene":
            candidate["_scene_parts"].append(paragraph.text)
        elif prompt_part == "prompt":
            candidate["_prompt_parts"].append(paragraph.text)

    finish_candidate()
    digest = hashlib.sha256(source_path.read_bytes()).hexdigest()
    return {
        "source": {"version": source_version, "sha256": digest},
        "governance": _governance(paragraphs),
        "entries": entries,
    }
