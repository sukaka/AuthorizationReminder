from sqlalchemy import select


def test_upload_txt_attachment_extracts_and_encrypts_text(
    generation_client,
    generation_db,
    seeded_task,
):
    from app.models import GenerationAttachment

    response = generation_client.post(
        "/api/ai/attachments",
        data={"task_uuid": seeded_task.uuid},
        files={
            "file": (
                "meeting.txt",
                "会议内容".encode("utf-8"),
                "text/plain",
            )
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["file_name"] == "meeting.txt"
    assert body["status"] == "READY"
    assert body["extracted_characters"] == 4

    attachment = generation_db.scalar(
        select(GenerationAttachment).where(
            GenerationAttachment.uuid == body["attachment_uuid"]
        )
    )
    assert attachment is not None
    assert attachment.file_name == "meeting.txt"
    assert attachment.extracted_text_ciphertext
    assert "会议内容".encode("utf-8") not in attachment.extracted_text_ciphertext
