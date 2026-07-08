def test_get_active_task_returns_dynamic_fields(generation_client, seeded_task):
    seeded_task.code = "work-summary"
    seeded_task.uuid = "work-summary"
    seeded_task.description = "动态工作总结"
    seeded_task.status = "ACTIVE"

    response = generation_client.get("/api/ai/tasks/work-summary")

    assert response.status_code == 200
    payload = response.json()
    assert payload["uuid"] == "work-summary"
    assert payload["name"] == seeded_task.name
    assert payload["fields"][0]["field_key"] == "work_content"
    assert payload["fields"][0]["field_type"] == "TEXTAREA"


def test_get_task_hides_drafts(generation_client, seeded_task):
    seeded_task.code = "work-summary"
    seeded_task.status = "DRAFT"

    response = generation_client.get("/api/ai/tasks/work-summary")

    assert response.status_code == 404
