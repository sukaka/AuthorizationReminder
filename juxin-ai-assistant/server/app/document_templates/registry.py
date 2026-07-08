from __future__ import annotations

from .base import DocumentTemplate, GenericDocumentTemplate
from .templates import MEETING_MINUTES_TEMPLATE, PROJECT_REPORT_TEMPLATE, WORK_PLAN_TEMPLATE


GENERIC_TEMPLATE = GenericDocumentTemplate()
DOCUMENT_TEMPLATES = {
    GENERIC_TEMPLATE.code: GENERIC_TEMPLATE,
    WORK_PLAN_TEMPLATE.code: WORK_PLAN_TEMPLATE,
    MEETING_MINUTES_TEMPLATE.code: MEETING_MINUTES_TEMPLATE,
    PROJECT_REPORT_TEMPLATE.code: PROJECT_REPORT_TEMPLATE,
}


def get_document_template(template_code: str | None) -> DocumentTemplate:
    return DOCUMENT_TEMPLATES.get(template_code or "", GENERIC_TEMPLATE)
