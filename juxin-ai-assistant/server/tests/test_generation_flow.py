import base64
import hashlib
import json

import httpx
import pytest
from sqlalchemy import select

from app.crypto import ContentCipher, EncryptedPayload
from app.governance_models import AuditLog
from app.models import GenerationRecord


TEST_KEY = base64.urlsafe_b64encode(b"k" * 32).decode("ascii")
PUBLISHED_PROMPT = {
    "prompt_id": 7,
    "version_id": 11,
    "version_no": 3,
    "title": "周报总结",
    "summary": "",
    "content": "请根据以下内容生成周报：{{work_content}}",
    "tags": ["通用"],
    "variables": ["work_content"],
}


def mock_published_prompt(respx_mock) -> None:
    respx_mock.get(
        "http://prompt.test:5189/api/prompt-center/runtime/prompts/7/published"
    ).mock(return_value=httpx.Response(200, json=PUBLISHED_PROMPT))


def prepare_generation(generation_client, seeded_task, respx_mock):
    mock_published_prompt(respx_mock)
    return generation_client.post(
        "/api/ai/generations/prepare",
        json={
            "task_uuid": seeded_task.uuid,
            "inputs": {"work_content": "完成统一登录接入"},
        },
    )


def test_prepare_returns_provider_neutral_messages_and_stores_ciphertext(
    generation_client,
    generation_db,
    seeded_task,
    respx_mock,
) -> None:
    response = prepare_generation(generation_client, seeded_task, respx_mock)

    assert response.status_code == 201
    payload = response.json()
    assert payload["messages"][0]["role"] == "system"
    assert "完成统一登录接入" in payload["messages"][1]["content"]
    serialized = json.dumps(payload).lower()
    for forbidden in ("api_key", "base_url", "authorization", '"model"'):
        assert forbidden not in serialized

    record = generation_db.scalar(select(GenerationRecord))
    assert record is not None
    assert "完成统一登录接入".encode() not in record.input_ciphertext
    decrypted = ContentCipher(TEST_KEY).decrypt_json(
        EncryptedPayload(record.input_ciphertext, record.input_nonce),
        record.uuid.encode(),
    )
    assert decrypted == {"inputs": {"work_content": "完成统一登录接入"}}
    assert record.prompt_external_id == 7
    assert record.prompt_version == 3
    assert record.completion_token_hash != payload["completion_token"].encode()


def test_formal_report_system_message_includes_document_governance_once(
    generation_client,
    generation_db,
    seeded_task,
    respx_mock,
) -> None:
    seeded_task.formal_document = True
    seeded_task.document_type = "REPORT"
    generation_db.commit()

    response = prepare_generation(generation_client, seeded_task, respx_mock)

    assert response.status_code == 201
    system_content = response.json()["messages"][0]["content"]
    assert system_content.count("聚信得仁公司级统一输出总控要求") == 1
    assert "【当前文档类型固定结构】" in system_content
    assert "工作概述、执行过程、结果统计" in system_content


@pytest.mark.parametrize("document_type", ["COMMUNICATION", "PLAIN_TEXT"])
def test_non_formal_messages_do_not_include_document_template_rules(
    generation_client,
    generation_db,
    seeded_task,
    respx_mock,
    document_type,
) -> None:
    seeded_task.formal_document = False
    seeded_task.document_type = document_type
    generation_db.commit()

    response = prepare_generation(generation_client, seeded_task, respx_mock)

    assert response.status_code == 201
    system_content = response.json()["messages"][0]["content"]
    assert "聚信得仁公司级统一输出总控要求" not in system_content
    assert "封面包含" not in system_content
    assert "页眉显示" not in system_content
    assert "需要表格的内容必须使用标准表格" not in system_content


def test_prepare_writes_body_free_audit_in_the_generation_transaction(
    generation_client,
    generation_db,
    seeded_task,
    respx_mock,
) -> None:
    # Given: an active task backed by a published Prompt Center version.
    mock_published_prompt(respx_mock)

    # When: an employee prepares a generation.
    response = generation_client.post(
        "/api/ai/generations/prepare",
        json={
            "task_uuid": seeded_task.uuid,
            "inputs": {"work_content": "private employee input"},
        },
    )

    # Then: the generation and its body-free audit event commit together.
    assert response.status_code == 201
    generation = generation_db.scalar(select(GenerationRecord))
    audit = generation_db.scalar(
        select(AuditLog).where(AuditLog.action == "generation.prepare")
    )
    assert generation is not None
    assert audit is not None
    assert audit.entity_uuid == generation.uuid
    assert audit.metadata_json == {
        "task_uuid": seeded_task.uuid,
        "generation_uuid": generation.uuid,
        "prompt_external_id": 7,
        "prompt_version": 3,
        "status": "PENDING",
    }
    assert "private employee input" not in repr(audit.metadata_json)


def test_complete_encrypts_output_and_records_non_secret_model_metadata(
    generation_client,
    generation_db,
    seeded_task,
    respx_mock,
) -> None:
    prepared = prepare_generation(generation_client, seeded_task, respx_mock).json()

    response = generation_client.post(
        f"/api/ai/generations/{prepared['generation_uuid']}/complete",
        json={
            "completion_token": prepared["completion_token"],
            "output": "这是生成结果",
            "model_display_name": "我的本地模型",
            "model_id": "qwen-local",
            "latency_ms": 820,
            "usage": {"input_tokens": 20, "output_tokens": 30},
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "generation_uuid": prepared["generation_uuid"],
        "status": "COMPLETED",
    }
    record = generation_db.scalar(
        select(GenerationRecord).where(
            GenerationRecord.uuid == prepared["generation_uuid"]
        )
    )
    assert record.status == "COMPLETED"
    assert record.model_display_name == "我的本地模型"
    assert record.model_id == "qwen-local"
    assert "这是生成结果".encode() not in record.output_ciphertext
    decrypted = ContentCipher(TEST_KEY).decrypt_json(
        EncryptedPayload(record.output_ciphertext, record.output_nonce),
        record.uuid.encode(),
    )
    assert decrypted == {"output": "这是生成结果"}
    audit = generation_db.scalar(
        select(AuditLog).where(AuditLog.action == "generation.complete")
    )
    assert audit is not None
    assert audit.entity_uuid == record.uuid
    assert audit.metadata_json == {
        "generation_uuid": record.uuid,
        "status": "COMPLETED",
    }
    assert "这是生成结果" not in repr(audit.metadata_json)


def test_complete_rejects_another_sso_user(
    generation_client,
    generation_db,
    seeded_task,
) -> None:
    token = "correct-completion-token"
    cipher = ContentCipher(TEST_KEY)
    generation_uuid = "generation-owned-by-other-user"
    encrypted = cipher.encrypt_json(
        {"inputs": {"work_content": "秘密"}},
        generation_uuid.encode(),
    )
    generation_db.add(GenerationRecord(
        uuid=generation_uuid,
        sso_user_id="another-user",
        username_snapshot="other",
        task_id=seeded_task.id,
        prompt_external_id=7,
        prompt_version=3,
        input_ciphertext=encrypted.ciphertext,
        input_nonce=encrypted.nonce,
        key_version="v1",
        completion_token_hash=hashlib.sha256(token.encode()).digest(),
        status="PENDING",
    ))
    generation_db.commit()

    response = generation_client.post(
        f"/api/ai/generations/{generation_uuid}/complete",
        json={
            "completion_token": token,
            "output": "结果",
            "model_display_name": "本地模型",
            "model_id": "qwen",
            "latency_ms": 1,
        },
    )

    assert response.status_code == 403


def test_complete_rejects_wrong_token_and_repeated_completion(
    generation_client,
    generation_db,
    seeded_task,
    respx_mock,
) -> None:
    prepared = prepare_generation(generation_client, seeded_task, respx_mock).json()
    body = {
        "completion_token": "wrong-token",
        "output": "结果",
        "model_display_name": "本地模型",
        "model_id": "qwen",
        "latency_ms": 1,
    }

    denied = generation_client.post(
        f"/api/ai/generations/{prepared['generation_uuid']}/complete",
        json=body,
    )
    assert denied.status_code == 403

    body["completion_token"] = prepared["completion_token"]
    completed = generation_client.post(
        f"/api/ai/generations/{prepared['generation_uuid']}/complete",
        json=body,
    )
    repeated = generation_client.post(
        f"/api/ai/generations/{prepared['generation_uuid']}/complete",
        json=body,
    )
    assert completed.status_code == 200
    assert repeated.status_code == 409
    assert len(list(generation_db.scalars(
        select(AuditLog).where(AuditLog.action == "generation.complete")
    ))) == 1


def test_prepare_returns_stable_validation_code_before_prompt_lookup(
    generation_client,
    generation_db,
    seeded_task,
    respx_mock,
) -> None:
    response = generation_client.post(
        "/api/ai/generations/prepare",
        json={
            "task_uuid": seeded_task.uuid,
            "inputs": {
                "work_content": "有效内容",
                "api_key": "不应被服务端接收",
            },
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "TASK_INPUT_INVALID"
    assert generation_db.scalar(select(GenerationRecord)) is None
    assert not respx_mock.calls


def test_prepare_requires_current_sensitive_confirmation_digest(
    generation_client,
    generation_db,
    seeded_task,
    respx_mock,
) -> None:
    body = {
        "task_uuid": seeded_task.uuid,
        "inputs": {"work_content": "联系 13800138000 完成统一登录接入"},
    }

    warning = generation_client.post("/api/ai/generations/prepare", json=body)

    assert warning.status_code == 409
    payload = warning.json()["detail"]
    assert payload["code"] == "SENSITIVE_CONFIRMATION_REQUIRED"
    assert payload["findings"] == [
        {
            "code": "PHONE",
            "field": "work_content",
            "preview": "***",
        }
    ]
    assert "13800138000" not in json.dumps(payload, ensure_ascii=False)
    assert generation_db.scalar(select(GenerationRecord)) is None
    assert not respx_mock.calls

    mock_published_prompt(respx_mock)
    confirmed = generation_client.post(
        "/api/ai/generations/prepare",
        json={
            **body,
            "sensitive_confirmation_digest": payload["confirmation_digest"],
        },
    )
    assert confirmed.status_code == 201

    changed = generation_client.post(
        "/api/ai/generations/prepare",
        json={
            **body,
            "inputs": {"work_content": "联系 13900139000 完成统一登录接入"},
            "sensitive_confirmation_digest": payload["confirmation_digest"],
        },
    )
    assert changed.status_code == 409
    assert (
        changed.json()["detail"]["confirmation_digest"]
        != payload["confirmation_digest"]
    )
