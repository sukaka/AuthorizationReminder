import pytest

from app.field_validation import FieldValidationError, validate_task_inputs


def field(
    field_type: str,
    *,
    required: bool = True,
    options: list | None = None,
    validation: dict | None = None,
) -> list[dict]:
    return [
        {
            "field_key": "value",
            "field_type": field_type,
            "required": required,
            "options_json": options or [],
            "validation_json": validation or {},
        }
    ]


def test_rejects_missing_required_and_unknown_fields() -> None:
    fields = field("TEXT", validation={"max_length": 20})
    with pytest.raises(FieldValidationError, match="value.*必填"):
        validate_task_inputs(fields, {})
    with pytest.raises(FieldValidationError, match="未知字段"):
        validate_task_inputs(fields, {"value": "周报", "api_key": "secret"})


@pytest.mark.parametrize(
    ("field_type", "value", "options"),
    [
        ("TEXT", "内容", []),
        ("TEXTAREA", "多行\n内容", []),
        ("SELECT", "A", ["A", "B"]),
        ("MULTISELECT", ["A"], [{"label": "甲", "value": "A"}]),
        ("DATE", "2026-06-19", []),
        ("NUMBER", 3, []),
        ("SWITCH", True, []),
    ],
)
def test_accepts_supported_field_types(
    field_type: str,
    value: object,
    options: list,
) -> None:
    assert validate_task_inputs(
        field(field_type, options=options),
        {"value": value},
    ) == {"value": value}


@pytest.mark.parametrize(
    ("fields", "value", "message"),
    [
        (field("TEXT", validation={"max_length": 2}), "过长文本", "最大长度"),
        (field("SELECT", options=["A"]), "B", "选项无效"),
        (field("MULTISELECT", options=["A"]), ["B"], "多选值无效"),
        (field("DATE"), "2026-02-30", "日期无效"),
        (field("NUMBER", validation={"min": 2}), 1, "小于最小值"),
        (field("NUMBER", validation={"max": 2}), 3, "大于最大值"),
        (field("SWITCH"), "true", "布尔值"),
        (field("FILE_RESERVED"), "fake-file", "文件上传尚未启用"),
    ],
)
def test_rejects_invalid_values(
    fields: list[dict],
    value: object,
    message: str,
) -> None:
    with pytest.raises(FieldValidationError, match=message):
        validate_task_inputs(fields, {"value": value})
