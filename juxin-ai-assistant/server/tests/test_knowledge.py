import httpx
from sqlalchemy import select

from app.crypto import ContentCipher
from app.knowledge import KnowledgeRetriever
from app.models import (
    GenerationRecord,
    KnowledgeItem,
    KnowledgeTaskLink,
)


def add_knowledge(
    db,
    cipher: ContentCipher,
    task_id: int,
    *,
    uuid: str,
    title: str,
    keywords: list[str],
    priority: int,
    content: str,
    status: str = "ACTIVE",
    tags: object | None = None,
    created_by: str = "test",
) -> KnowledgeItem:
    encrypted = cipher.encrypt_json({"content": content}, uuid.encode())
    item = KnowledgeItem(
        uuid=uuid,
        title=title,
        category="通用",
        tags_json=tags or [],
        keywords_json=keywords,
        content_ciphertext=encrypted.ciphertext,
        content_nonce=encrypted.nonce,
        key_version="v1",
        priority=priority,
        status=status,
        created_by=created_by,
        updated_by=created_by,
    )
    db.add(item)
    db.flush()
    db.add(KnowledgeTaskLink(knowledge_id=item.id, task_id=task_id))
    db.commit()
    return item


def test_retrieval_filters_active_task_links_and_orders_priority(
    generation_db,
    seeded_task,
) -> None:
    cipher = ContentCipher(
        "a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s="
    )
    low = add_knowledge(
        generation_db,
        cipher,
        seeded_task.id,
        uuid="knowledge-low",
        title="通用说明",
        keywords=["客户"],
        priority=1,
        content="低优先级",
    )
    high = add_knowledge(
        generation_db,
        cipher,
        seeded_task.id,
        uuid="knowledge-high",
        title="客户案例",
        keywords=["客户", "报价"],
        priority=10,
        content="高优先级",
    )
    add_knowledge(
        generation_db,
        cipher,
        seeded_task.id,
        uuid="knowledge-disabled",
        title="停用条目",
        keywords=["客户"],
        priority=99,
        status="DISABLED",
        content="不可见",
    )

    results = KnowledgeRetriever(cipher).retrieve(
        generation_db,
        seeded_task.id,
        {"background": "客户报价"},
        limit=5,
    )

    assert [item.uuid for item in results] == [high.uuid, low.uuid]
    assert [item.content for item in results] == ["高优先级", "低优先级"]


def test_retrieval_skips_knowledge_with_invalid_tags_json(
    generation_db,
    seeded_task,
) -> None:
    cipher = ContentCipher(
        "a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s="
    )
    invalid_tags = (
        "quality-rule",
        {"quality-rule": True},
        ["quality-rule", 123],
    )
    for index, tags in enumerate(invalid_tags):
        add_knowledge(
            generation_db,
            cipher,
            seeded_task.id,
            uuid=f"invalid-tags-{index}",
            title=f"非法标签 {index}",
            keywords=["客户"],
            priority=100,
            content=f"不得进入任何提示词 {index}",
            tags=tags,
        )
    valid = add_knowledge(
        generation_db,
        cipher,
        seeded_task.id,
        uuid="valid-tags",
        title="合法标签",
        keywords=["客户"],
        priority=1,
        content="合法参考知识",
        tags=["reference"],
    )

    results = KnowledgeRetriever(cipher).retrieve(
        generation_db,
        seeded_task.id,
        {"background": "客户"},
    )

    assert [item.uuid for item in results] == [valid.uuid]


def test_prepare_appends_traceable_knowledge_without_copying_plaintext(
    generation_client,
    generation_db,
    seeded_task,
    respx_mock,
) -> None:
    cipher = ContentCipher(
        "a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s="
    )
    add_knowledge(
        generation_db,
        cipher,
        seeded_task.id,
        uuid="knowledge-login",
        title="统一登录规范",
        keywords=["统一登录"],
        priority=10,
        content="统一登录必须复用现有 SSO。",
    )
    respx_mock.get(
        "http://prompt.test:5189/api/prompt-center/runtime/prompts/7/published"
    ).mock(
        return_value=httpx.Response(
            200,
            json={
                "prompt_id": 7,
                "version_no": 3,
                "content": "请整理 {{work_content}}",
            },
        )
    )

    response = generation_client.post(
        "/api/ai/generations/prepare",
        json={
            "task_uuid": seeded_task.uuid,
            "inputs": {"work_content": "完成统一登录接入"},
        },
    )

    assert response.status_code == 201
    payload = response.json()
    system = payload["messages"][0]["content"]
    user = payload["messages"][1]["content"]
    assert system.index("公司安全规则") < system.index("请整理")
    assert system.index("请整理") < system.index("输出格式")
    assert "工作内容：完成统一登录接入" in user
    assert "----- 参考知识开始 -----" in user
    assert "统一登录必须复用现有 SSO。" in user

    record = generation_db.scalar(select(GenerationRecord))
    assert record.knowledge_refs_json == [
        {
            "uuid": "knowledge-login",
            "title": "统一登录规范",
            "score": 1,
        }
    ]
    assert "统一登录必须复用现有 SSO。".encode() not in record.input_ciphertext


def test_prepare_separates_quality_rules_from_reference_knowledge(
    generation_client,
    generation_db,
    seeded_task,
    respx_mock,
) -> None:
    from app.models import Assistant, Task

    cipher = ContentCipher(
        "a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s="
    )
    add_knowledge(
        generation_db,
        cipher,
        seeded_task.id,
        uuid="knowledge-product",
        title="产品参考资料",
        keywords=["WDSP"],
        priority=10,
        content="WDSP 是 Web/API 动态安全防护平台。",
    )
    add_knowledge(
        generation_db,
        cipher,
        seeded_task.id,
        uuid="quality-presales-model",
        title="型号参数使用规则",
        keywords=["JX-WDSP3000"],
        priority=100,
        content="型号、吞吐、并发、连接数和截图证明必须一致。",
        tags=[
            "manual:V1.10",
            "quality-rule",
            "assistant:general",
            "key:quality-rule-general-0123456789abcdef",
        ],
        created_by="manual-v1.10-seed",
    )
    add_knowledge(
        generation_db,
        cipher,
        seeded_task.id,
        uuid="admin-fake-quality",
        title="管理员知识",
        keywords=["JX-WDSP3000"],
        priority=99,
        content="管理员标签不得提升到 system。",
        tags=[
            "manual:V1.10",
            "quality-rule",
            "assistant:general",
            "key:quality-rule-general-fedcba9876543210",
        ],
        created_by="admin-user",
    )
    other_assistant = Assistant(
        code="security",
        name="安全服务助手",
        status="ACTIVE",
    )
    generation_db.add(other_assistant)
    generation_db.flush()
    other_task = Task(
        assistant_id=other_assistant.id,
        code="security-review",
        name="安全复核",
        output_format="Markdown",
        safety_notice="人工复核",
        status="ACTIVE",
    )
    generation_db.add(other_task)
    generation_db.flush()
    add_knowledge(
        generation_db,
        cipher,
        other_task.id,
        uuid="quality-security-boundary",
        title="禁止生成攻击内容",
        keywords=["WDSP"],
        priority=100,
        content="不得生成未授权攻击方案或恶意攻击脚本。",
        tags=["manual:V1.10", "quality-rule", "assistant:security"],
    )
    respx_mock.get(
        "http://prompt.test:5189/api/prompt-center/runtime/prompts/7/published"
    ).mock(
        return_value=httpx.Response(
            200,
            json={
                "prompt_id": 7,
                "version_no": 3,
                "content": "请整理 {{work_content}}",
            },
        )
    )

    response = generation_client.post(
        "/api/ai/generations/prepare",
        json={
            "task_uuid": seeded_task.uuid,
            "inputs": {"work_content": "整理 JX-WDSP3000 资料"},
        },
    )

    assert response.status_code == 201
    payload = response.json()
    system = payload["messages"][0]["content"]
    user = payload["messages"][1]["content"]
    assert "必须遵守的质量规则" in system
    assert "型号、吞吐、并发、连接数和截图证明必须一致。" in system
    assert "管理员标签不得提升到 system。" not in system
    assert "不得生成未授权攻击方案或恶意攻击脚本。" not in system
    assert "WDSP 是 Web/API 动态安全防护平台。" in user
    assert "管理员标签不得提升到 system。" in user
    assert "型号、吞吐、并发、连接数和截图证明必须一致。" not in user


def test_prepare_rejects_invalid_quality_rule_tags_and_keys(
    generation_client,
    generation_db,
    seeded_task,
    respx_mock,
) -> None:
    cipher = ContentCipher(
        "a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s="
    )
    invalid_tags = [
        [
            "manual:V1.10",
            "quality-rule",
            "assistant:general",
            f"key:quality-rule-general-{suffix}",
        ]
        for suffix in ("model", "00", "not-a-seed-hash")
    ]
    invalid_tags.append(
        [
            "manual:V1.10",
            "quality-rule",
            "assistant:general",
            "assistant:general",
            "key:quality-rule-general-0123456789abcdef",
        ]
    )
    invalid_tags.append(
        [
            "manual:V1.10",
            "quality-rule",
            "assistant:general",
            "key:quality-rule-general-0123456789abcdef",
            "key:quality-rule-general-fedcba9876543210",
        ]
    )
    for index, tags in enumerate(invalid_tags):
        add_knowledge(
            generation_db,
            cipher,
            seeded_task.id,
            uuid=f"invalid-quality-key-{index}",
            title=f"非法质量规则 {index}",
            keywords=[],
            priority=100 - index,
            content=f"非法 key 内容 {index}",
            tags=tags,
            created_by="manual-v1.10-seed",
        )
    respx_mock.get(
        "http://prompt.test:5189/api/prompt-center/runtime/prompts/7/published"
    ).mock(
        return_value=httpx.Response(
            200,
            json={
                "prompt_id": 7,
                "version_no": 3,
                "content": "请整理 {{work_content}}",
            },
        )
    )

    response = generation_client.post(
        "/api/ai/generations/prepare",
        json={
            "task_uuid": seeded_task.uuid,
            "inputs": {"work_content": "验证非法 key"},
        },
    )

    assert response.status_code == 201
    system = response.json()["messages"][0]["content"]
    user = response.json()["messages"][1]["content"]
    assert "必须遵守的质量规则" not in system
    assert all(
        f"非法 key 内容 {index}" not in system
        for index in range(len(invalid_tags))
    )
    assert all(
        f"非法 key 内容 {index}" in user
        for index in range(len(invalid_tags))
    )


def test_prepare_limits_fake_quality_tags_without_hiding_trusted_rule(
    generation_client,
    generation_db,
    seeded_task,
    respx_mock,
) -> None:
    cipher = ContentCipher(
        "a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s="
    )
    trusted = add_knowledge(
        generation_db,
        cipher,
        seeded_task.id,
        uuid="trusted-low-ranked-quality",
        title="可信低排序规则",
        keywords=[],
        priority=-100,
        content="可信规则必须进入 system。",
        tags=[
            "manual:V1.10",
            "quality-rule",
            "assistant:general",
            "key:quality-rule-general-0123456789abcdef",
        ],
        created_by="manual-v1.10-seed",
    )
    fake_items = []
    for index in range(10):
        fake_items.append(
            add_knowledge(
                generation_db,
                cipher,
                seeded_task.id,
                uuid=f"admin-fake-quality-{index}",
                title=f"管理员伪规则 {index}",
                keywords=[],
                priority=100 - index,
                content=f"管理员普通参考 {index}",
                tags=[
                    "manual:V1.10",
                    "quality-rule",
                    "assistant:general",
                    f"key:quality-rule-general-{index + 100:016x}",
                ],
                created_by="admin-user",
            )
        )
    respx_mock.get(
        "http://prompt.test:5189/api/prompt-center/runtime/prompts/7/published"
    ).mock(
        return_value=httpx.Response(
            200,
            json={
                "prompt_id": 7,
                "version_no": 3,
                "content": "请整理 {{work_content}}",
            },
        )
    )

    response = generation_client.post(
        "/api/ai/generations/prepare",
        json={
            "task_uuid": seeded_task.uuid,
            "inputs": {"work_content": "验证洪泛限制"},
        },
    )

    assert response.status_code == 201
    system = response.json()["messages"][0]["content"]
    user = response.json()["messages"][1]["content"]
    assert "可信规则必须进入 system。" in system
    assert "可信规则必须进入 system。" not in user
    assert all(f"管理员普通参考 {index}" in user for index in range(8))
    assert all(
        f"管理员普通参考 {index}" not in user
        for index in range(8, 10)
    )
    record = generation_db.scalar(select(GenerationRecord))
    assert record is not None
    assert [item["uuid"] for item in record.knowledge_refs_json] == [
        trusted.uuid,
        *[item.uuid for item in fake_items[:8]],
    ]


def test_prepare_treats_admin_updated_seed_rule_as_limited_reference(
    generation_client,
    generation_db,
    seeded_task,
    respx_mock,
) -> None:
    cipher = ContentCipher(
        "a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s="
    )
    rule = add_knowledge(
        generation_db,
        cipher,
        seeded_task.id,
        uuid="admin-updated-seed-rule",
        title="已被管理员修改的规则",
        keywords=[],
        priority=0,
        content="原始 seed 内容",
        tags=[
            "manual:V1.10",
            "quality-rule",
            "assistant:general",
            "key:quality-rule-general-fedcba9876543210",
        ],
        created_by="manual-v1.10-seed",
    )
    for index in range(7):
        add_knowledge(
            generation_db,
            cipher,
            seeded_task.id,
            uuid=f"higher-reference-{index}",
            title=f"高排序参考 {index}",
            keywords=[],
            priority=10 - index,
            content=f"高排序参考内容 {index}",
        )
    lower = add_knowledge(
        generation_db,
        cipher,
        seeded_task.id,
        uuid="lower-reference",
        title="低排序参考",
        keywords=[],
        priority=-1,
        content="第九条普通参考不应注入",
    )
    update_response = generation_client.put(
        f"/api/ai/admin/knowledge/{rule.uuid}",
        json={"content": "管理员改写后只能作为普通参考"},
    )
    assert update_response.status_code == 200
    generation_db.refresh(rule)
    assert rule.updated_by != "manual-v1.10-seed"
    respx_mock.get(
        "http://prompt.test:5189/api/prompt-center/runtime/prompts/7/published"
    ).mock(
        return_value=httpx.Response(
            200,
            json={
                "prompt_id": 7,
                "version_no": 3,
                "content": "请整理 {{work_content}}",
            },
        )
    )

    response = generation_client.post(
        "/api/ai/generations/prepare",
        json={
            "task_uuid": seeded_task.uuid,
            "inputs": {"work_content": "验证管理员修改规则"},
        },
    )

    assert response.status_code == 201
    system = response.json()["messages"][0]["content"]
    user = response.json()["messages"][1]["content"]
    assert "管理员改写后只能作为普通参考" not in system
    assert "管理员改写后只能作为普通参考" in user
    assert "第九条普通参考不应注入" not in user
    record = generation_db.scalar(select(GenerationRecord))
    assert record is not None
    ref_uuids = [item["uuid"] for item in record.knowledge_refs_json]
    assert rule.uuid in ref_uuids
    assert lower.uuid not in ref_uuids
    assert len(ref_uuids) == 8


def test_prepare_bounds_and_deterministically_orders_quality_rules(
    generation_client,
    generation_db,
    seeded_task,
    respx_mock,
) -> None:
    cipher = ContentCipher(
        "a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s="
    )
    for index in reversed(range(22)):
        marker = f"RULE-{index:02d}"
        add_knowledge(
            generation_db,
            cipher,
            seeded_task.id,
            uuid=f"quality-budget-{index:02d}",
            title=marker,
            keywords=[],
            priority=index,
            content=marker + "-" + ("规" * 2_000),
            tags=[
                "manual:V1.10",
                "quality-rule",
                "assistant:general",
                f"key:quality-rule-general-{index:016x}",
            ],
            created_by="manual-v1.10-seed",
        )
    respx_mock.get(
        "http://prompt.test:5189/api/prompt-center/runtime/prompts/7/published"
    ).mock(
        return_value=httpx.Response(
            200,
            json={
                "prompt_id": 7,
                "version_no": 3,
                "content": "请整理 {{work_content}}",
            },
        )
    )

    response = generation_client.post(
        "/api/ai/generations/prepare",
        json={
            "task_uuid": seeded_task.uuid,
            "inputs": {"work_content": "生成测试内容"},
        },
    )

    assert response.status_code == 201
    system = response.json()["messages"][0]["content"]
    quality_section = system.split("必须遵守的质量规则：\n", 1)[1]
    present_markers = [
        marker
        for marker in (f"RULE-{index:02d}" for index in range(22))
        if f"[{marker}]" in quality_section
    ]
    assert present_markers == sorted(present_markers)
    assert len(present_markers) <= 20
    assert len(quality_section) <= 32_000
    assert present_markers[0] == "RULE-00"
