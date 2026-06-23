from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile


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
KNOWLEDGE_TITLES = {
    "公司知识库",
    "统一的公司知识提示词",
    "统一公司知识提示词",
}
QUALITY_RULE_TITLES = {
    "统一输出质量规则",
    "产品名称与术语规范",
    "WDSP资料使用规则",
    "型号参数使用规则",
}

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

FIELD_PLACEHOLDER_PATTERN = re.compile(
    r"【(?P<bracket_label>[^】\n]+)】"
    r"(?P<spacing>\s*)"
    r"(?P<bracket_placeholder>\[[^\]\n]+\])"
    r"|"
    r"(?P<colon_label>[\u4e00-\u9fffA-Za-z0-9（）()、/]+)"
    r"(?P<separator>[：:])"
    r"(?P<colon_placeholder>\[[^\]\n]+\])"
)
TITLE_NUMBER_PATTERN = re.compile(
    r"^\s*(?:(?:\d+|[一二三四五六七八九十百]+)[.．、]\s*)+"
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
        parts: list[str] = []
        for value in node.iter():
            if value.tag == f"{W}t":
                parts.append(value.text or "")
            elif value.tag in {f"{W}br", f"{W}cr"}:
                parts.append("\n")
            elif value.tag == f"{W}tab":
                parts.append("\t")
        text = "".join(parts)
        if text:
            paragraphs.append(Paragraph(style=style, text=text))
    return paragraphs


def _normalized_title(title: str) -> str:
    return TITLE_NUMBER_PATTERN.sub("", title.strip()).strip()


def classify_candidate(title: str) -> str:
    normalized = _normalized_title(title)
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

    def register(
        raw_label: str,
        placeholder: str,
    ) -> str | None:
        label = _field_label(raw_label)
        field_key = FIELD_KEY_BY_LABEL.get(label)
        if field_key is None:
            unresolved_key = (label, placeholder)
            if unresolved_key not in seen_unresolved:
                seen_unresolved.add(unresolved_key)
                unresolved.append(
                    {"label": label, "placeholder": placeholder}
                )
            return None
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
        return field_key

    def replace(match: re.Match[str]) -> str:
        raw_label = (
            match.group("bracket_label")
            or match.group("colon_label")
        )
        placeholder = (
            match.group("bracket_placeholder")
            or match.group("colon_placeholder")
        )
        field_key = register(
            raw_label,
            placeholder,
        )
        if field_key is None:
            return match.group(0)
        if match.group("bracket_label") is not None:
            return (
                f"【{raw_label}】{match.group('spacing')}"
                f"{{{{{field_key}}}}}"
            )
        return (
            f"{raw_label}{match.group('separator')}"
            f"{{{{{field_key}}}}}"
        )

    prompt = FIELD_PLACEHOLDER_PATTERN.sub(replace, prompt)
    return prompt, fields, unresolved


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
    default_title = "聚信得仁公司级统一输出总控要求"
    for index, paragraph in enumerate(paragraphs):
        normalized = re.sub(r"\s+", "", paragraph.text)
        if paragraph.style not in {"Heading1", "Heading2"}:
            continue
        if (
            "统一输出总控模块" not in normalized
            and "统一输出总控要求" not in normalized
        ):
            continue
        body: list[str] = []
        for following in paragraphs[index + 1 :]:
            if following.style == "Heading1":
                break
            if (
                paragraph.style == "Heading2"
                and following.style == "Heading2"
            ):
                break
            if following.style == "Prompt标题":
                continue
            if following.style in {"Prompt正文", "正文", ""}:
                body.append(following.text)
            if (
                following.style == "Prompt正文"
                and "统一输出总控要求" in following.text
            ):
                match = re.search(
                    r"【([^】]*统一输出总控要求)】",
                    following.text,
                )
                return {
                    "title": (
                        match.group(1)
                        if match is not None
                        else default_title
                    ),
                    "content": following.text,
                }
        if body:
            return {
                "title": default_title,
                "content": "\n".join(body),
            }
    return {"title": default_title, "content": ""}


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
            category = _normalized_title(text)
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
            normalized_heading = _normalized_title(text)
            if candidate is not None and normalized_heading in {
                "使用场景",
                "标准Prompt",
                "标准提示词",
                "使用注意事项",
            }:
                prompt_part = {
                    "使用场景": "scene",
                    "标准Prompt": "prompt",
                    "标准提示词": "prompt",
                    "使用注意事项": "ignore",
                }[normalized_heading]
                continue
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
                "标准Prompt": "prompt",
                "标准提示词": "prompt",
            }.get(text)
            continue
        if paragraph.style not in {"Prompt正文", "正文", ""}:
            continue
        scene_match = re.match(
            r"^适用场景[：:]\s*(.*)$",
            paragraph.text,
            flags=re.DOTALL,
        )
        if prompt_part is None and scene_match is not None:
            candidate["_scene_parts"].append(
                scene_match.group(1).strip()
            )
            continue
        if prompt_part == "scene":
            candidate["_scene_parts"].append(paragraph.text)
        elif prompt_part == "prompt":
            candidate["_prompt_parts"].append(paragraph.text)
        elif prompt_part != "ignore":
            candidate["_prompt_parts"].append(paragraph.text)

    finish_candidate()
    digest = hashlib.sha256(source_path.read_bytes()).hexdigest()
    return {
        "source": {"version": source_version, "sha256": digest},
        "governance": _governance(paragraphs),
        "entries": entries,
    }


def build_manifest(compiled: dict[str, Any]) -> dict[str, Any]:
    entries = compiled["entries"]
    unresolved = [
        {
            "section": entry["section"],
            "source_title": entry["source_title"],
            "items": entry["unresolved"],
        }
        for entry in entries
        if entry["unresolved"]
    ]
    return {
        "source": compiled["source"],
        "governance": compiled["governance"],
        "tasks": [
            entry
            for entry in entries
            if entry["classification"] == "TASK"
        ],
        "knowledge": [
            entry
            for entry in entries
            if entry["classification"] == "KNOWLEDGE"
        ],
        "quality_rules": [
            entry
            for entry in entries
            if entry["classification"] == "QUALITY_RULE"
        ],
        "excluded": [
            entry
            for entry in entries
            if entry["classification"] == "EXCLUDED"
        ],
        "unresolved": unresolved,
    }


def build_report(manifest: dict[str, Any]) -> dict[str, Any]:
    names = (
        "tasks",
        "knowledge",
        "quality_rules",
        "excluded",
        "unresolved",
    )
    return {
        "counts": {
            name: len(manifest[name])
            for name in names
        },
        **{
            name: manifest[name]
            for name in names
        },
    }


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            value,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="编译聚信得仁 DOCX Prompt 手册",
    )
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument(
        "--source-version",
        default="V1.10",
    )
    args = parser.parse_args(argv)
    try:
        compiled = compile_manual(
            args.input,
            args.source_version,
        )
        manifest = build_manifest(compiled)
        report = build_report(manifest)
        _write_json(args.output, manifest)
        _write_json(args.report, report)
    except (
        BadZipFile,
        ElementTree.ParseError,
        KeyError,
        OSError,
    ) as error:
        print(
            f"无法编译 DOCX：{error}",
            file=sys.stderr,
        )
        return 1
    print(
        json.dumps(report["counts"], ensure_ascii=False, sort_keys=True)
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
