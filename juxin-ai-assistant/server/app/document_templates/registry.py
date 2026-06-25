from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from app.word_export import render_generation_docx

from .base import DocumentRenderPayload
from .company_style import COMPANY_REQUIRED_SECTIONS, FINAL_REVIEW_SECTIONS
from .structure_validator import strip_duplicate_template_headings


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
        return render_generation_docx(
            title=payload.title,
            task_name=payload.task_name,
            department=payload.department,
            author=payload.author,
            output=self.normalize_output(payload.output),
            version=payload.version,
        )


GENERIC_TEMPLATE = GenericDocumentTemplate()
DOCUMENT_TEMPLATES = {
    GENERIC_TEMPLATE.code: GENERIC_TEMPLATE,
}


def get_document_template(template_code: str | None):
    return DOCUMENT_TEMPLATES.get(template_code or "", GENERIC_TEMPLATE)
