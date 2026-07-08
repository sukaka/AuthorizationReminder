def test_favorite_put_and_delete_are_idempotent(
    client_for_user,
    active_task,
) -> None:
    client = client_for_user("u-1")

    assert client.put(
        f"/api/ai/favorites/{active_task.uuid}"
    ).status_code == 204
    assert client.put(
        f"/api/ai/favorites/{active_task.uuid}"
    ).status_code == 204
    assert client.delete(
        f"/api/ai/favorites/{active_task.uuid}"
    ).status_code == 204
    assert client.delete(
        f"/api/ai/favorites/{active_task.uuid}"
    ).status_code == 204


def test_home_returns_user_scoped_metadata_without_content(
    client_for_user,
    active_task,
    records,
) -> None:
    client_for_user("u-1").put(f"/api/ai/favorites/{active_task.uuid}")

    payload = client_for_user("u-1").get("/api/ai/home").json()

    assert set(payload) == {
        "favorites",
        "recent_tasks",
        "recent_generations",
        "safety_reminders",
    }
    assert [item["task_uuid"] for item in payload["favorites"]] == [
        active_task.uuid
    ]
    assert len(payload["recent_tasks"]) == 1
    assert len(payload["recent_tasks"]) <= 8
    assert [item["uuid"] for item in payload["recent_generations"]] == [
        records.u1.uuid
    ]
    assert all(
        "input" not in item and "output" not in item
        for item in payload["recent_generations"]
    )

    other = client_for_user("u-2").get("/api/ai/home").json()
    assert other["favorites"] == []
    assert [item["uuid"] for item in other["recent_generations"]] == [
        records.u2.uuid
    ]
