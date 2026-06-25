from __future__ import annotations

from dataclasses import dataclass

from .base import GenericDocumentTemplate
from .structure_validator import (
    HEADING_PATTERN,
    normalize_heading_text,
)


ACTION_ITEM_HEADER = "| 序号 | 事项 | 责任人 | 截止时间 | 状态 | 备注 |"
ACTION_ITEM_TABLE = """| 序号 | 事项 | 责任人 | 截止时间 | 状态 | 备注 |
|---|---|---|---|---|---|
| 1 | 待确认 | 待确认 | 待确认 | 待确认 | 待确认 |"""


@dataclass(frozen=True)
class FixedStructureTemplate(GenericDocumentTemplate):
    def normalize_output(self, output: str) -> str:
        preserved_lines, sections = self._parse_sections(output)
        sections = self._normalize_sections(sections)
        return self._build_output(preserved_lines, sections)

    def _parse_sections(self, output: str) -> tuple[list[str], dict[str, list[str]]]:
        fixed_by_normalized_heading = {
            normalize_heading_text(heading): heading
            for heading in self.fixed_headings
        }
        sections = {heading: [] for heading in self.fixed_headings}
        preserved_lines: list[str] = []
        current_fixed_heading: str | None = None

        for line in output.splitlines():
            match = HEADING_PATTERN.match(line.strip())
            if match:
                heading_level = len(match.group(1))
                fixed_heading = fixed_by_normalized_heading.get(
                    normalize_heading_text(match.group(2))
                )
                if fixed_heading:
                    current_fixed_heading = fixed_heading
                    continue

                if current_fixed_heading and heading_level > 1:
                    sections[current_fixed_heading].append(line)
                    continue

                current_fixed_heading = None
                preserved_lines.append(line)
                continue

            if current_fixed_heading:
                sections[current_fixed_heading].append(line)
            else:
                preserved_lines.append(line)

        return preserved_lines, sections

    def _normalize_sections(self, sections: dict[str, list[str]]) -> dict[str, list[str]]:
        return sections

    def _build_output(self, preserved_lines: list[str], sections: dict[str, list[str]]) -> str:
        preserved = "\n".join(_strip_outer_blank_lines(preserved_lines)).strip()
        sections = [
            f"# {heading}\n\n{_section_text(sections[heading])}"
            for heading in self.fixed_headings
        ]

        return "\n\n".join(part for part in (preserved, *sections) if part).strip()


@dataclass(frozen=True)
class MeetingMinutesTemplate(FixedStructureTemplate):
    def _normalize_sections(self, sections: dict[str, list[str]]) -> dict[str, list[str]]:
        action_item_lines = sections["待办事项表"]
        if ACTION_ITEM_HEADER not in "\n".join(action_item_lines):
            sections = {heading: list(lines) for heading, lines in sections.items()}
            existing_lines = _strip_outer_blank_lines(action_item_lines)
            table_lines = ACTION_ITEM_TABLE.splitlines()
            sections["待办事项表"] = (
                [*existing_lines, "", *table_lines] if existing_lines else table_lines
            )

        return sections


def _section_text(lines: list[str]) -> str:
    text = "\n".join(_strip_outer_blank_lines(lines)).strip()
    return text or "待确认"


def _strip_outer_blank_lines(lines: list[str]) -> list[str]:
    start = 0
    end = len(lines)
    while start < end and not lines[start].strip():
        start += 1
    while end > start and not lines[end - 1].strip():
        end -= 1
    return lines[start:end]


WORK_PLAN_TEMPLATE = FixedStructureTemplate(
    code="work_plan_v1",
    name="阶段工作计划模板",
    fixed_headings=(
        "基本信息",
        "背景说明",
        "工作目标与范围",
        "阶段划分与时间安排",
        "任务分工与责任人",
        "交付物清单",
        "风险与依赖条件",
        "需确认事项",
        "需人工复核事项",
        "下一步动作",
    ),
)

PROJECT_REPORT_TEMPLATE = FixedStructureTemplate(
    code="project_report_v1",
    name="项目汇报模板",
    fixed_headings=(
        "基本信息",
        "项目背景",
        "当前进展",
        "已完成工作",
        "关键数据或结果统计",
        "存在问题",
        "风险与影响",
        "需协调事项",
        "下一步计划",
        "需人工复核事项",
    ),
)

MEETING_MINUTES_TEMPLATE = MeetingMinutesTemplate(
    code="meeting_minutes_v1",
    name="会议纪要模板",
    fixed_headings=(
        "会议基本信息",
        "会议背景",
        "讨论议题",
        "关键结论",
        "决议事项",
        "待办事项表",
        "风险与分歧",
        "待确认事项",
        "需人工复核事项",
        "下一步安排",
    ),
)
