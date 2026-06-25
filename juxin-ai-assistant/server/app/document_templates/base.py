from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, Sequence


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


class DocumentTemplate(Protocol):
    code: str
    name: str
    fixed_headings: Sequence[str]

    def normalize_output(self, output: str) -> str:
        raise NotImplementedError

    def render_docx(self, payload: DocumentRenderPayload) -> bytes:
        raise NotImplementedError
