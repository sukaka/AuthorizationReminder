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

INCIDENT_REPORT_TEMPLATE = FixedStructureTemplate(
    code="incident_report_v1",
    name="安全事件报告模板",
    fixed_headings=(
        "基本信息",
        "事件概述",
        "发现与上报",
        "影响范围",
        "处置过程",
        "根因分析",
        "临时措施",
        "长期整改",
        "经验教训",
        "需人工复核事项",
    ),
)

RISK_ASSESSMENT_TEMPLATE = FixedStructureTemplate(
    code="risk_assessment_v1",
    name="风险评估模板",
    fixed_headings=(
        "评估对象与范围",
        "资产识别",
        "威胁与脆弱性",
        "风险分析",
        "风险等级",
        "处置建议",
        "残余风险",
        "责任人与时限",
        "需确认事项",
        "需人工复核事项",
    ),
)

ACCEPTANCE_REPORT_TEMPLATE = FixedStructureTemplate(
    code="acceptance_report_v1",
    name="项目验收报告模板",
    fixed_headings=(
        "项目基本信息",
        "验收依据",
        "建设内容与交付物",
        "功能验收结果",
        "性能与安全验收",
        "遗留问题",
        "验收结论",
        "双方签字确认",
        "附件清单",
        "需人工复核事项",
    ),
)

WEEKLY_REPORT_TEMPLATE = FixedStructureTemplate(
    code="weekly_report_v1",
    name="周报模板",
    fixed_headings=(
        "本周工作概述",
        "重点进展",
        "数据与指标",
        "问题与风险",
        "需协调事项",
        "下周计划",
        "需人工复核事项",
    ),
)

SOP_TEMPLATE = FixedStructureTemplate(
    code="sop_v1",
    name="标准作业程序(SOP)模板",
    fixed_headings=(
        "目的",
        "适用范围",
        "职责",
        "术语定义",
        "操作步骤",
        "输入输出与表单",
        "异常处理",
        "相关制度",
        "版本与修订",
        "需人工复核事项",
    ),
)

TOOL_UPDATE_RECORD_TEMPLATE = FixedStructureTemplate(
    code="tool_update_record_v1",
    name="工具更新记录模板",
    fixed_headings=(
        "更新摘要",
        "变更范围",
        "兼容性说明",
        "部署与回滚",
        "验证清单",
        "已知问题",
        "影响用户",
        "责任人",
        "需人工复核事项",
    ),
)

POLICY_INTERPRETATION_TEMPLATE = FixedStructureTemplate(
    code="policy_interpretation_v1",
    name="制度解读模板",
    fixed_headings=(
        "制度名称与版本",
        "适用对象",
        "核心条款摘要",
        "执行要点",
        "常见问题",
        "违规后果",
        "相关链接",
        "需确认事项",
        "需人工复核事项",
    ),
)
