from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class SkillVersionCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_schema: dict[str, Any]
    output_schema: dict[str, Any]
    plan_definition: dict[str, Any]
    prompt_bundle: dict[str, Any]
    allowed_resource_types: list[str] = Field(default_factory=list, max_length=64)
    allowed_tool_ids: list[str] = Field(default_factory=list, max_length=64)
    required_fact_policy: dict[str, Any]
    quality_rule_set_version_ids: list[str] = Field(default_factory=list, max_length=64)
    default_template_version_uuid: str = Field(min_length=1, max_length=36)
    review_checklist: list[str] = Field(default_factory=list, max_length=64)


class TemplateVersionCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_schema: dict[str, Any]
    structure_dsl: dict[str, Any]
    dynamic_tables: list[dict[str, Any]] = Field(default_factory=list, max_length=64)
    conditional_sections: list[dict[str, Any]] = Field(
        default_factory=list,
        max_length=64,
    )
    style_theme: dict[str, Any] = Field(default_factory=dict)
    word_render_config: dict[str, Any] = Field(default_factory=dict)
    compatible_skill_version_uuids: list[str] = Field(
        default_factory=list,
        max_length=128,
    )


class SkillSelectIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    objective: str = Field(min_length=1, max_length=4000)
    deliverable_type: str = Field(min_length=1, max_length=64)
    scope_type: Literal["personal", "project"] = "personal"
    project_uuid: str | None = Field(default=None, min_length=1, max_length=36)
    input_fields: dict[str, Any] = Field(default_factory=dict)
    explicit_skill_version_uuid: str | None = Field(default=None, max_length=36)
    task_bound_skill_version_uuid: str | None = Field(default=None, max_length=36)
    model_suggested_skill_version_uuids: list[str] = Field(
        default_factory=list,
        max_length=32,
    )
    user_confirmed: bool = False

    @field_validator(
        "objective",
        "deliverable_type",
        "project_uuid",
        "explicit_skill_version_uuid",
        "task_bound_skill_version_uuid",
        mode="before",
    )
    @classmethod
    def strip_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value
