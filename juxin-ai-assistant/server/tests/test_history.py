import httpx
from sqlalchemy import select

from app.governance_models import AuditLog
from app.models import GenerationRecord


def test_user_only_reads_own_history(client_for_user, records) -> None:
    response = client_for_user("u-1").get("/api/ai/generations")

    assert response.status_code == 200
    assert {item["uuid"] for item in response.json()["items"]} == {
        records.u1.uuid
    }
    assert "input" not in response.json()["items"][0]
    assert "output" not in response.json()["items"][0]


def test_detail_decrypts_owner_record_only(client_for_user, records) -> None:
    own = client_for_user("u-1").get(
        f"/api/ai/generations/{records.u1.uuid}"
    )
    other = client_for_user("u-2").get(
        f"/api/ai/generations/{records.u1.uuid}"
    )

    assert own.status_code == 200
    assert own.json()["input"] == {"work_content": "用户一内容"}
    assert own.json()["output"] == "用户一内容 的生成结果"
    assert other.status_code == 404


def test_owner_downloads_completed_generation_word(client_for_user, records) -> None:
    response = client_for_user("u-1").get(
        f"/api/ai/generations/{records.u1.uuid}/export.docx"
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    assert response.content.startswith(b"PK")


def test_other_user_cannot_export_generation(client_for_user, records) -> None:
    response = client_for_user("u-2").get(
        f"/api/ai/generations/{records.u1.uuid}/export.docx"
    )

    assert response.status_code == 404


def test_generation_export_audit_excludes_body_and_filename(
    client_for_user,
    generation_db,
    records,
    seeded_task,
) -> None:
    seeded_task.name = '周报:总结/\r\n坏";x=y'
    generation_db.commit()

    response = client_for_user("u-1").get(
        f"/api/ai/generations/{records.u1.uuid}/export.docx"
    )

    assert response.status_code == 200
    content_disposition = response.headers["content-disposition"]
    assert "\r" not in content_disposition
    assert "\n" not in content_disposition
    assert "/" not in content_disposition
    assert ":" not in content_disposition
    ascii_filename = content_disposition.split('filename="', 1)[1].split(
        '";',
        1,
    )[0]
    assert '"' not in ascii_filename
    assert ";" not in ascii_filename
    assert "%22" not in content_disposition.upper()
    assert "%3B" not in content_disposition.upper()
    assert "%3A" not in content_disposition.upper()
    assert "%2F" not in content_disposition.upper()
    assert "%0D" not in content_disposition.upper()
    assert "%0A" not in content_disposition.upper()
    assert "filename*" in content_disposition
    audit = generation_db.scalar(
        select(AuditLog).where(AuditLog.action == "generation.export_word")
    )
    assert audit is not None
    assert audit.metadata_json == {
        "generation_uuid": records.u1.uuid,
        "task_uuid": seeded_task.uuid,
        "status": "COMPLETED",
    }
    assert "用户一内容 的生成结果" not in repr(audit.metadata_json)
    assert "filename" not in repr(audit.metadata_json).lower()


def test_delete_tombstones_owner_ciphertext_only(
    client_for_user,
    generation_db,
    records,
) -> None:
    before = records.u1.input_ciphertext

    denied = client_for_user("u-2").delete(
        f"/api/ai/generations/{records.u1.uuid}"
    )
    deleted = client_for_user("u-1").delete(
        f"/api/ai/generations/{records.u1.uuid}"
    )

    assert denied.status_code == 404
    assert deleted.status_code == 204
    generation_db.refresh(records.u1)
    assert records.u1.status == "DELETED"
    assert records.u1.input_ciphertext != before
    assert records.u1.output_ciphertext == records.u1.input_ciphertext
    audit = generation_db.scalar(
        select(AuditLog).where(AuditLog.action == "generation.delete")
    )
    assert audit is not None
    assert audit.entity_uuid == records.u1.uuid
    assert audit.metadata_json == {
        "generation_uuid": records.u1.uuid,
        "status": "DELETED",
    }


def test_regenerate_creates_child_record(
    client_for_user,
    generation_db,
    records,
    seeded_task,
    respx_mock,
) -> None:
    respx_mock.get(
        "http://prompt.test:5189/api/prompt-center/runtime/prompts/7/published"
    ).mock(
        return_value=httpx.Response(
            200,
            json={
                "prompt_id": 7,
                "version_no": 4,
                "content": "请重新整理 {{work_content}}",
            },
        )
    )

    response = client_for_user("u-1").post(
        f"/api/ai/generations/{records.u1.uuid}/regenerate"
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["parent_generation_uuid"] == records.u1.uuid
    assert payload["generation_uuid"] != records.u1.uuid
    assert payload["completion_token"]
    child = generation_db.scalar(
        select(GenerationRecord).where(
            GenerationRecord.uuid == payload["generation_uuid"]
        )
    )
    assert child.parent_generation_id == records.u1.id
    assert child.sso_user_id == "u-1"
    audit = generation_db.scalar(
        select(AuditLog).where(AuditLog.action == "generation.regenerate")
    )
    assert audit is not None
    assert audit.entity_uuid == child.uuid
    assert audit.metadata_json == {
        "generation_uuid": child.uuid,
        "task_uuid": seeded_task.uuid,
        "prompt_external_id": 7,
        "prompt_version": 4,
        "status": "PENDING",
    }
