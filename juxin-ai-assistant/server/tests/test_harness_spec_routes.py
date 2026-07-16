from __future__ import annotations

from copy import deepcopy

from app.harness_spec import load_harness_spec


def test_harness_spec_admin_workflow_requires_independent_approval(client_for_user) -> None:
    author = client_for_user("author", "admin")
    reviewer = client_for_user("reviewer", "admin")
    operator = client_for_user("operator", "admin")

    listed = author.get("/api/ai/ops/harness-specs")
    assert listed.status_code == 200, listed.text
    assert listed.json()["items"][0]["status"] == "active"

    payload = deepcopy(load_harness_spec())
    payload["spec_version"] = "1.0.1"
    registered = author.post("/api/ai/ops/harness-specs", json={"payload": payload})
    assert registered.status_code == 201, registered.text
    spec_uuid = registered.json()["uuid"]

    submitted = author.post(f"/api/ai/ops/harness-specs/{spec_uuid}/submit")
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["status"] == "pending_approval"

    denied = author.post(f"/api/ai/ops/harness-specs/{spec_uuid}/approve")
    assert denied.status_code == 409

    approved = reviewer.post(f"/api/ai/ops/harness-specs/{spec_uuid}/approve")
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"

    active = operator.post(f"/api/ai/ops/harness-specs/{spec_uuid}/activate")
    assert active.status_code == 200, active.text
    assert active.json()["status"] == "active"


def test_harness_spec_routes_require_admin(client_for_user) -> None:
    employee = client_for_user("employee", "employee")

    response = employee.get("/api/ai/ops/harness-specs")

    assert response.status_code == 403
