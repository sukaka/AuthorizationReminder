"""Declared user-triggered side effects guarded by the direct-action ledger."""

from dataclasses import dataclass
from importlib import import_module
from typing import Any

from pydantic import BaseModel


@dataclass(frozen=True)
class DirectActionContract:
    action_name: str
    source_file: str
    side_effect: str
    response_model_path: str


DIRECT_ACTION_CONTRACTS = (
    DirectActionContract(
        "web_capture_preview", "app/web_routes.py", "outbound web fetch", "app.schemas:WebCapturePreviewOut"
    ),
    DirectActionContract(
        "web_capture_confirm", "app/web_routes.py", "knowledge-file creation", "app.schemas:WebCaptureConfirmOut"
    ),
    DirectActionContract("export_word", "app/export_routes.py", "Word file export", "app.schemas:ExportWordOut"),
    DirectActionContract(
        "export_content_word", "app/export_routes.py", "Word file export", "app.schemas:ExportWordOut"
    ),
    DirectActionContract(
        "external_support_ticket_reply",
        "app/admin/external_support_ticket_routes.py",
        "external support reply",
        "app.admin.external_support_ticket_routes:ExternalSupportTicketOut",
    ),
    DirectActionContract(
        "knowledge_file_upload",
        "app/knowledge_routes.py",
        "knowledge-file storage write",
        "app.schemas:KnowledgeFileOut",
    ),
)


def direct_action_contract(action_name: str) -> DirectActionContract | None:
    return next((item for item in DIRECT_ACTION_CONTRACTS if item.action_name == action_name), None)


def normalize_direct_action_response(action_name: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Validate an operator-confirmed replay against the original endpoint contract."""
    contract = direct_action_contract(action_name)
    if contract is None:
        raise ValueError(f"unknown direct action: {action_name}")
    module_name, model_name = contract.response_model_path.split(":", maxsplit=1)
    response_model = getattr(import_module(module_name), model_name)
    if not isinstance(response_model, type) or not issubclass(response_model, BaseModel):
        raise TypeError(f"invalid response model for direct action: {action_name}")
    return response_model.model_validate(payload).model_dump(mode="json")
