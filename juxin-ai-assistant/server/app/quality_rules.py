import re
from dataclasses import dataclass


QUALITY_RULE_SEED_ACTOR = "manual-v1.10-seed"
QUALITY_RULE_SOURCE_TAG = "manual:V1.10"
QUALITY_RULE_TAG = "quality-rule"


@dataclass(frozen=True)
class ParsedQualityRuleTags:
    assistant_code: str
    key: str


def strict_string_tags(value: object) -> tuple[str, ...] | None:
    if not isinstance(value, (list, tuple)) or not all(
        isinstance(tag, str) for tag in value
    ):
        return None
    return tuple(value)


def parse_quality_rule_tags(
    value: object,
    *,
    expected_assistant_code: str | None = None,
) -> ParsedQualityRuleTags | None:
    tags = strict_string_tags(value)
    if tags is None:
        return None
    if (
        tags.count(QUALITY_RULE_SOURCE_TAG) != 1
        or tags.count(QUALITY_RULE_TAG) != 1
    ):
        return None
    assistant_tags = [
        tag.removeprefix("assistant:")
        for tag in tags
        if tag.startswith("assistant:")
    ]
    key_tags = [
        tag.removeprefix("key:")
        for tag in tags
        if tag.startswith("key:")
    ]
    if len(assistant_tags) != 1 or len(key_tags) != 1:
        return None
    assistant_code = assistant_tags[0]
    if (
        not assistant_code
        or (
            expected_assistant_code is not None
            and assistant_code != expected_assistant_code
        )
        or re.fullmatch(
            rf"quality-rule-{re.escape(assistant_code)}-[0-9a-f]{{16}}",
            key_tags[0],
        )
        is None
    ):
        return None
    return ParsedQualityRuleTags(
        assistant_code=assistant_code,
        key=key_tags[0],
    )


def is_trusted_quality_rule(
    value: object,
    *,
    assistant_code: str,
    created_by: str,
    updated_by: str,
) -> bool:
    return (
        created_by == QUALITY_RULE_SEED_ACTOR
        and updated_by == QUALITY_RULE_SEED_ACTOR
        and parse_quality_rule_tags(
            value,
            expected_assistant_code=assistant_code,
        )
        is not None
    )
