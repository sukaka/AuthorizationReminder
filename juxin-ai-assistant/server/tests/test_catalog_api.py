from app.models import Assistant, KnowledgeItem, KnowledgeTaskLink, Task, TaskField


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
        document_template_code="quote-docx",
        attachment_policy_json={"max_files": 3, "required": True},
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
    quote_payload = next(
        task
        for assistant in payload["assistants"]
        for task in assistant["tasks"]
        if task["code"] == "quote-explanation"
    )
    assert quote_payload["document_template_code"] == "quote-docx"
    assert quote_payload["attachment_policy"] == {
        "max_files": 3,
        "required": True,
    }


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


def test_intent_route_returns_ranked_active_task_candidates(
    generation_client,
    generation_db,
    seeded_task,
) -> None:
    seeded_task.name = "工作总结"
    seeded_task.description = "整理周期工作成果"
    generation_db.commit()

    response = generation_client.post(
        "/api/ai/intent/route",
        json={"query": "帮我整理这周工作总结"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["candidates"][0]["task_uuid"] == seeded_task.uuid
    assert payload["candidates"][0]["task_code"] == seeded_task.code
    assert payload["candidates"][0]["score"] > 0
    assert "任务名称匹配：工作总结" in payload["candidates"][0]["reasons"]


def test_capabilities_include_prompt_binding_and_field_health(
    generation_client,
    generation_db,
    seeded_task,
) -> None:
    knowledge = KnowledgeItem(
        title="公司统一输出要求",
        category="quality_rule",
        content_ciphertext=b"encrypted",
        content_nonce=b"nonce",
        key_version="v1",
        created_by="tester",
        updated_by="tester",
    )
    generation_db.add(knowledge)
    generation_db.flush()
    generation_db.add(KnowledgeTaskLink(knowledge_id=knowledge.id, task_id=seeded_task.id))
    generation_db.commit()

    response = generation_client.get("/api/ai/capabilities")

    assert response.status_code == 200
    item = response.json()["items"][0]
    assert item["task_uuid"] == seeded_task.uuid
    assert item["assistant_name"] == "通用办公助手"
    assert item["input_fields"][0]["field_key"] == "work_content"
    assert item["output_format"] == "Markdown"
    assert item["prompt_binding_status"] == "configured"
    assert item["knowledge_link_count"] == 1
