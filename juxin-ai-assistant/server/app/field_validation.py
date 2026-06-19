from datetime import date


class FieldValidationError(ValueError):
    pass


SUPPORTED_TYPES = {
    "TEXT",
    "TEXTAREA",
    "SELECT",
    "MULTISELECT",
    "DATE",
    "NUMBER",
    "SWITCH",
    "FILE_RESERVED",
}


def _option_values(raw_options: list) -> set[object]:
    values: set[object] = set()
    for item in raw_options:
        if isinstance(item, dict):
            if "value" in item:
                values.add(item["value"])
        else:
            values.add(item)
    return values


def _missing(value: object) -> bool:
    return value is None or value == "" or value == []


def validate_task_inputs(
    fields: list[dict],
    values: dict[str, object],
) -> dict[str, object]:
    allowed = {str(item["field_key"]): item for item in fields}
    unknown = sorted(set(values) - set(allowed))
    if unknown:
        raise FieldValidationError(f"未知字段：{', '.join(unknown)}")

    normalized: dict[str, object] = {}
    for key, field in allowed.items():
        field_type = str(field["field_type"]).upper()
        if field_type not in SUPPORTED_TYPES:
            raise FieldValidationError(f"{key} 的字段类型不受支持")

        value = values.get(key)
        if field.get("required") and _missing(value):
            raise FieldValidationError(f"{key} 为必填项")
        if _missing(value):
            continue

        rules = field.get("validation_json") or {}
        options = _option_values(field.get("options_json") or [])
        if field_type in {"TEXT", "TEXTAREA"}:
            text = str(value).strip()
            if len(text) > int(rules.get("max_length", 20_000)):
                raise FieldValidationError(f"{key} 超过最大长度")
            normalized[key] = text
        elif field_type == "SELECT":
            if value not in options:
                raise FieldValidationError(f"{key} 选项无效")
            normalized[key] = value
        elif field_type == "MULTISELECT":
            if not isinstance(value, list) or not set(value) <= options:
                raise FieldValidationError(f"{key} 多选值无效")
            normalized[key] = value
        elif field_type == "DATE":
            try:
                normalized[key] = date.fromisoformat(str(value)).isoformat()
            except ValueError as exc:
                raise FieldValidationError(f"{key} 日期无效") from exc
        elif field_type == "NUMBER":
            if isinstance(value, bool):
                raise FieldValidationError(f"{key} 数字无效")
            try:
                number = float(value)
            except (TypeError, ValueError) as exc:
                raise FieldValidationError(f"{key} 数字无效") from exc
            if "min" in rules and number < float(rules["min"]):
                raise FieldValidationError(f"{key} 小于最小值")
            if "max" in rules and number > float(rules["max"]):
                raise FieldValidationError(f"{key} 大于最大值")
            normalized[key] = value if isinstance(value, (int, float)) else number
        elif field_type == "SWITCH":
            if not isinstance(value, bool):
                raise FieldValidationError(f"{key} 必须是布尔值")
            normalized[key] = value
        else:
            raise FieldValidationError(f"{key} 的文件上传尚未启用")
    return normalized
