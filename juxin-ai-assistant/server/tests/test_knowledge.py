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
) -> KnowledgeItem:
    encrypted = cipher.encrypt_json({"content": content}, uuid.encode())
    item = KnowledgeItem(
        uuid=uuid,
        title=title,
        category="通用",
        tags_json=[],
        keywords_json=keywords,
        content_ciphertext=encrypted.ciphertext,
        content_nonce=encrypted.nonce,
        key_version="v1",
        priority=priority,
        status=status,
        created_by="test",
        updated_by="test",
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
