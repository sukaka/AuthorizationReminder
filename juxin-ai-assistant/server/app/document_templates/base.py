from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, Sequence

from .company_style import COMPANY_REQUIRED_SECTIONS, FINAL_REVIEW_SECTIONS
from .structure_validator import strip_duplicate_template_headings


@dataclass(frozen=True)
class StructureIssue:
    code: str
    message: str
    severity: str = "warning"


@dataclass(frozen=True)
class DocumentRenderPayload:
    title: str
    task_name: str
    department: str
    author: str
    output: str
    version: str
    inputs: dict[str, object] = field(default_factory=dict)
    attachments: list[dict[str, object]] = field(default_factory=list)


@dataclass(frozen=True)
class GenericDocumentTemplate:
    code: str = "generic_v1"
    name: str = "通用正式文档模板"
    fixed_headings: Sequence[str] = COMPANY_REQUIRED_SECTIONS + FINAL_REVIEW_SECTIONS

    def normalize_output(self, output: str) -> str:
        return strip_duplicate_template_headings(
            output,
            fixed_headings=self.fixed_headings,
        )

    def render_docx(self, payload: DocumentRenderPayload) -> bytes:
        from app.word_export import render_generation_docx

        return render_generation_docx(
            title=payload.title,
            task_name=payload.task_name,
            department=payload.department,
            author=payload.author,
            output=self.normalize_output(payload.output),
            version=payload.version,
        )


class DocumentTemplate(Protocol):
    code: str
    name: str
    fixed_headings: Sequence[str]

    def normalize_output(self, output: str) -> str:
        raise NotImplementedError

    def render_docx(self, payload: DocumentRenderPayload) -> bytes:
        raise NotImplementedError
