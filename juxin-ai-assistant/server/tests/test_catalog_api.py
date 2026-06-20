from app.models import Assistant, Task, TaskField


def test_catalog_returns_all_active_assistants_without_prompt_internals(
    generation_client,
    generation_db,
    seeded_task,
) -> None:
    sales = Assistant(
        code="sales",
        name="销售助手",
        description="报价、合同与回款",
        status="ACTIVE",
        sort_order=20,
    )
    generation_db.add(sales)
    generation_db.flush()
    quote = Task(
        assistant_id=sales.id,
        code="quote-explanation",
        name="报价说明生成",
        description="生成报价说明",
        status="ACTIVE",
    )
    generation_db.add(quote)
    generation_db.flush()
    generation_db.add(
        TaskField(
            task_id=quote.id,
            field_key="background",
            label="背景",
            field_type="TEXTAREA",
            required=True,
        )
    )
    generation_db.commit()

    payload = generation_client.get("/api/ai/catalog").json()

    assert {
        item["code"]
        for item in payload["assistants"]
    } == {"general", "sales"}
    serialized = str(payload).lower()
    assert "prompt_external_id" not in serialized
    assert "version_policy" not in serialized
    assert "prompt_content" not in serialized


def test_catalog_search_matches_assistant_and_task(
    generation_client,
    generation_db,
    seeded_task,
) -> None:
    seeded_task.name = "会议纪要"
    seeded_task.description = "整理会议结论"
    generation_db.commit()

    matched = generation_client.get(
        "/api/ai/catalog",
        params={"query": "会议"},
    ).json()
    missing = generation_client.get(
        "/api/ai/catalog",
        params={"query": "不存在"},
    ).json()

    assert matched["assistants"][0]["tasks"][0]["name"] == "会议纪要"
    assert missing == {"assistants": []}
