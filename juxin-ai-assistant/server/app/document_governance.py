import json
from functools import lru_cache
from pathlib import Path


DOCUMENT_TYPE_STRUCTURES = {
    "REPORT": "工作概述、执行过程、结果统计、风险问题、需确认事项、结论与下一步计划。",
    "PLAN": "背景说明、目标范围、实施步骤、资源安排、风险控制、验收标准。",
    "MINUTES": "会议基本信息、议题摘要、讨论要点、决议事项、待办事项、责任人与时间节点。",
    "DOCUMENT": "文档目的、适用范围、主要内容、操作说明、注意事项、维护与复核要求。",
    "CHECKLIST": "检查对象、检查项目、检查标准、检查结果、问题记录、整改建议。",
    "BID_DOCUMENT": "项目基本信息、招标要求、响应内容、证明材料、偏离说明、风险提示。",
    "FORMAL_NOTICE": "通知对象、事项背景、通知内容、执行要求、时间节点、联系人。",
    "ANALYSIS": "分析背景、已知事实、分析维度、判断依据、风险提示、建议动作。",
    "COMMUNICATION": "沟通背景、关键事实、沟通口径、注意事项、待确认问题、后续动作。",
    "PLAIN_TEXT": "",
}


@lru_cache
def load_governance() -> dict[str, object]:
    manifest_path = (
        Path(__file__).resolve().parents[1] / "catalog" / "manual-v1.10.json"
    )
    with manifest_path.open(encoding="utf-8") as handle:
        manifest = json.load(handle)

    governance = manifest["governance"]
    return {
        "control_prompt": governance["content"],
        "document_types": DOCUMENT_TYPE_STRUCTURES,
    }


def render_document_governance(*, formal_document: bool, document_type: str) -> str:
    if not formal_document:
        return ""
    rules = load_governance()
    document_types = rules["document_types"]
    structure = document_types.get(document_type) or document_types["DOCUMENT"]
    return f"{rules['control_prompt']}\n\n【当前文档类型固定结构】\n{structure}"
