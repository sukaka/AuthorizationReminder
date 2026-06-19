import httpx
from sqlalchemy import select

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


def test_regenerate_creates_child_record(
    client_for_user,
    generation_db,
    records,
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
