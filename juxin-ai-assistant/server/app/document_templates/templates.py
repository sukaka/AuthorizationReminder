from __future__ import annotations

from dataclasses import dataclass

from .base import GenericDocumentTemplate
from .structure_validator import (
    HEADING_PATTERN,
    normalize_heading_text,
    strip_duplicate_template_headings,
)


ACTION_ITEM_TABLE = """| 序号 | 事项 | 责任人 | 截止时间 | 状态 | 备注 |
|---|---|---|---|---|---|
| 1 | 待确认 | 待确认 | 待确认 | 待确认 | 待确认 |"""


@dataclass(frozen=True)
class FixedStructureTemplate(GenericDocumentTemplate):
    def normalize_output(self, output: str) -> str:
        cleaned = strip_duplicate_template_headings(
            output,
            fixed_headings=self.fixed_headings,
        )
        present_headings = {
            normalize_heading_text(match.group(2))
            for line in cleaned.splitlines()
            if (match := HEADING_PATTERN.match(line.strip()))
        }
        sections = [
            f"# {heading}\n\n待确认"
            for heading in self.fixed_headings
            if normalize_heading_text(heading) not in present_headings
        ]

        return "\n\n".join(part for part in (cleaned, *sections) if part).strip()


@dataclass(frozen=True)
class MeetingMinutesTemplate(FixedStructureTemplate):
    def normalize_output(self, output: str) -> str:
        normalized = super().normalize_output(output)
        if "| 序号 | 事项 | 责任人 | 截止时间 | 状态 | 备注 |" in normalized:
            return normalized

        return f"{normalized}\n\n{ACTION_ITEM_TABLE}".strip()


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
