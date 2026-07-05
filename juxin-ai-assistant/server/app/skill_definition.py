from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, field_validator


SkillStatus = Literal["draft", "pending_review", "published", "disabled"]
SkillScope = Literal["personal", "department", "company"]


class SkillPermissions(BaseModel):
    allow_web: bool = False
    allow_company_knowledge: bool = False
    allow_personal_memory: bool = False
    allow_write_company_kb: bool = False


class SkillReviewPolicy(BaseModel):
    required_for_publish: bool = True
    reviewer_role: str = "admin"


class SkillManifest(BaseModel):
    id: str
    name: str
    description: str
    category: str
    version: str
    status: SkillStatus = "draft"
    scope: SkillScope = "company"
    owner: str
    requires_attachment: bool = False
    allowed_tools: list[str] = Field(default_factory=list)
    input_types: list[str] = Field(default_factory=list)
    output_types: list[str] = Field(default_factory=list)
    permissions: SkillPermissions = Field(default_factory=SkillPermissions)
    review: SkillReviewPolicy = Field(default_factory=SkillReviewPolicy)
    tags: list[str] = Field(default_factory=list)

    @field_validator("id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized or not all(ch.isalnum() or ch in "-_" for ch in normalized):
            raise ValueError("skill id must use letters, digits, dash or underscore")
        return normalized

    @field_validator("allowed_tools", "input_types", "output_types", "tags")
    @classmethod
    def clean_list(cls, value: list[str]) -> list[str]:
        return [str(item).strip() for item in value if str(item).strip()]


class SkillDefinition(BaseModel):
    manifest: SkillManifest
    root: Path
    readme: str = ""
    system_prompt: str = ""
    task_prompt: str = ""
    output_prompt: str = ""
    input_schema: dict = Field(default_factory=dict)
    output_schema: dict = Field(default_factory=dict)
    good_example: str = ""
    bad_example: str = ""
    checklist: str = ""

    @property
    def id(self) -> str:
        return self.manifest.id

    @property
    def name(self) -> str:
        return self.manifest.name

    @property
    def status(self) -> str:
        return self.manifest.status

    @property
    def version(self) -> str:
        return self.manifest.version

    @property
    def allowed_tools(self) -> list[str]:
        return self.manifest.allowed_tools

    @property
    def requires_attachment(self) -> bool:
        return self.manifest.requires_attachment

    @property
    def permissions(self) -> SkillPermissions:
        return self.manifest.permissions
