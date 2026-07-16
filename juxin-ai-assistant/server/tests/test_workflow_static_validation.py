from __future__ import annotations


def test_static_preview_is_deterministic_and_reports_graph() -> None:
    from app.workflow_static import validate_workflow_definition

    result = validate_workflow_definition(
        {
            "id": "preview_flow",
            "steps": [
                {"id": "route", "type": "route", "params": {}},
                {
                    "id": "invoke",
                    "type": "invoke",
                    "params": {"agent_from": "route.selected_agent_id"},
                },
            ],
        }
    )

    assert result["valid"] is True
    assert result["preview"]["node_count"] == 2
    assert result["preview"]["edges"] == [{"from": "route", "to": "invoke"}]


def test_static_validation_fails_closed_for_illegal_loop_and_missing_approval() -> None:
    from app.workflow_static import validate_workflow_definition

    result = validate_workflow_definition(
        {
            "id": "unsafe_flow",
            "steps": [
                {"id": "loop", "type": "loop", "params": {}},
                {"id": "notify", "type": "notification", "params": {}},
            ],
        }
    )

    assert result["valid"] is False
    assert {item["code"] for item in result["errors"]} >= {
        "invalid_step_type",
        "unbounded_loop",
        "approval_required",
    }


def test_static_validation_rejects_project_outside_allow_list() -> None:
    from app.workflow_static import validate_workflow_definition

    result = validate_workflow_definition(
        {
            "id": "project_flow",
            "steps": [
                {
                    "id": "read",
                    "type": "project_read",
                    "params": {"project_uuid": "project-not-owned"},
                }
            ],
        },
        allowed_project_ids={"project-owned"},
        strict_project_scope=True,
    )

    assert result["valid"] is False
    assert any(item["code"] == "project_access_denied" for item in result["errors"])


def test_static_validation_rejects_unknown_business_action() -> None:
    from app.workflow_static import validate_workflow_definition

    result = validate_workflow_definition(
        {
            "id": "business_flow",
            "steps": [{"id": "run", "type": "business", "params": {"action": "python"}}],
        }
    )

    assert result["valid"] is False
    assert any(item["code"] == "invalid_business_action" for item in result["errors"])


def test_validate_endpoint_returns_diagnostics_without_persisting(generation_client) -> None:
    response = generation_client.post(
        "/api/ai/workflows/validate",
        json={
            "id": "preview_endpoint_flow",
            "steps": [{"id": "bad", "type": "unknown_node", "params": {}}],
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["valid"] is False
    assert any(item["code"] == "invalid_step_type" for item in payload["errors"])
    assert generation_client.get("/api/ai/workflows/preview_endpoint_flow").status_code == 404


def test_saved_validate_endpoint_has_clear_not_found_semantics(generation_client) -> None:
    response = generation_client.post("/api/ai/workflows/custom/missing_flow/validate")
    assert response.status_code == 404
    assert response.json()["detail"] == "workflow_not_found"
