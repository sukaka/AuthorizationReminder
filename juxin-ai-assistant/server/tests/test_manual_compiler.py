import sys
from pathlib import Path


SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

FIXTURE = Path(__file__).parent / "fixtures" / "manual-mini.docx"


def test_compiles_source_governance_and_first_sales_entry() -> None:
    from scripts.compile_prompt_manual import compile_manual

    result = compile_manual(FIXTURE, "V1.10")

    assert result["source"]["version"] == "V1.10"
    assert len(result["source"]["sha256"]) == 64
    assert (
        result["governance"]["title"]
        == "聚信得仁公司级统一输出总控要求"
    )
    assert result["entries"][0] == {
        "section": "销售",
        "category": "客户拜访",
        "source_title": "生成拜访前客户简报",
        "scene": "客户拜访前快速准备",
        "prompt": "请为聚信得仁销售人员生成一份客户拜访前简报。",
        "classification": "TASK",
        "fields": [],
        "unresolved": [],
    }


def test_classification_uses_only_audited_deterministic_rules() -> None:
    from scripts.compile_prompt_manual import classify_candidate

    assert classify_candidate("使用原则") == "EXCLUDED"
    assert classify_candidate("技术标书自查提示词") == "TASK"
    assert classify_candidate("公司知识库") == "KNOWLEDGE"
    assert classify_candidate("统一输出质量规则") == "QUALITY_RULE"
    assert classify_candidate("使用原则补充提示词") == "EXCLUDED"


def test_extracts_mapped_fields_and_preserves_unresolved_placeholders() -> None:
    from scripts.compile_prompt_manual import compile_manual

    result = compile_manual(FIXTURE, "V1.10")
    entry = result["entries"][1]

    assert entry["prompt"] == (
        "【客户信息】\n"
        "客户名称：{{customer_name}}\n"
        "客户沟通记录：{{communication_record}}\n"
        "以下是客户名单：{{customer_list}}\n"
        "补充背景：[填写]\n"
        "请生成客户跟进建议。"
    )
    assert entry["fields"] == [
        {
            "field_key": "customer_name",
            "label": "客户名称",
            "field_type": "TEXT",
            "required": True,
            "placeholder": "[填写]",
            "example": "",
            "options_json": [],
            "validation_json": {},
            "sort_order": 10,
        },
        {
            "field_key": "communication_record",
            "label": "客户沟通记录",
            "field_type": "TEXT",
            "required": True,
            "placeholder": "[粘贴客户沟通记录]",
            "example": "",
            "options_json": [],
            "validation_json": {},
            "sort_order": 20,
        },
        {
            "field_key": "customer_list",
            "label": "客户名单",
            "field_type": "TEXT",
            "required": True,
            "placeholder": "[粘贴客户名单]",
            "example": "",
            "options_json": [],
            "validation_json": {},
            "sort_order": 30,
        },
    ]
    assert entry["unresolved"] == [
        {"label": "补充背景", "placeholder": "[填写]"}
    ]


def test_keeps_source_order_and_is_byte_for_byte_deterministic() -> None:
    from scripts.compile_prompt_manual import compile_manual

    first = compile_manual(FIXTURE, "V1.10")
    second = compile_manual(FIXTURE, "V1.10")

    assert [entry["source_title"] for entry in first["entries"]] == [
        "生成拜访前客户简报",
        "客户跟进建议提示词",
        "售前方案澄清提示词",
        "检查测试用例是否合格",
    ]
    assert first == second
