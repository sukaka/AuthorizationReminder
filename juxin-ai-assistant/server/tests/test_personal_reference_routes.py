import os


def _cipher():
    from app.crypto import ContentCipher

    return ContentCipher(os.environ["CONTENT_ENCRYPTION_KEY"])


def _add_personal_file(
    db,
    *,
    user_id: str,
    name: str,
    text: str,
    conversation_id: str = "",
    usage_type: str = "personal_reference",
):
    from app.knowledge_files import create_knowledge_file_from_bytes

    file_record, _chunks = create_knowledge_file_from_bytes(
        db,
        sso_user_id=user_id,
        file_name=name,
        content=text.encode("utf-8"),
        content_type="text/plain",
        cipher=_cipher(),
        key_version="v1",
        visibility="PRIVATE",
        source_type="user_upload",
        usage_type=usage_type,
        review_status="draft",
        rag_enabled=False,
        reference_enabled=True,
        rag_scope="session" if usage_type == "session_attachment" else "personal",
        permission_scope="private",
        owner_user_id=user_id,
        conversation_id=conversation_id,
        target_chars=200,
        max_chars=300,
        overlap_chars=0,
    )
    db.commit()
    return file_record


def test_personal_reference_generate_uses_only_current_users_private_material(
    client_for_user,
    generation_db,
) -> None:
    owner_file = _add_personal_file(
        generation_db,
        user_id="user-1",
        name="我的会议记录.txt",
        text="一、会议记录\n聚信安全服务交付会议重点是部署培训和验收安排。",
    )
    _add_personal_file(
        generation_db,
        user_id="user-2",
        name="他人会议记录.txt",
        text="一、会议记录\n聚信安全服务价格折扣只应他人可见。",
    )
    client = client_for_user("user-1")

    response = client.post(
        "/api/personal-reference/generate",
        json={
            "question": "参考我的会议记录生成纪要",
            "mode": "normal",
            "top_k": 6,
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["answer"] == ""
    assert body["notice"] == "该内容参考用户个人上传资料生成，仅供当前用户使用。"
    assert body["sources"][0]["source_kind"] == "personal_reference"
    assert body["sources"][0]["file_id"] == owner_file.uuid
    assert body["sources"][0]["file_name"] == "我的会议记录.txt"
    assert all(source["file_name"] != "他人会议记录.txt" for source in body["sources"])
    assert "## personal_reference_context" in body["messages"][0]["content"]
    assert "个人资料不能作为公司正式依据" in body["messages"][0]["content"]


def test_personal_reference_search_returns_owner_reference_and_current_session_attachment_only(
    client_for_user,
    generation_db,
) -> None:
    owner_reference = _add_personal_file(
        generation_db,
        user_id="user-1",
        name="我的项目模板.txt",
        text="一、项目模板\n安全服务项目模板包含培训计划。",
    )
    session_attachment = _add_personal_file(
        generation_db,
        user_id="user-1",
        name="当前会议附件.txt",
        text="一、会议附件\n安全服务会议附件包含验收安排。",
        conversation_id="conv-1",
        usage_type="session_attachment",
    )
    _add_personal_file(
        generation_db,
        user_id="user-1",
        name="其他会话附件.txt",
        text="一、其他附件\n安全服务其他附件不应出现。",
        conversation_id="conv-2",
        usage_type="session_attachment",
    )
    _add_personal_file(
        generation_db,
        user_id="user-2",
        name="他人项目模板.txt",
        text="一、他人模板\n安全服务他人模板不应出现。",
    )
    client = client_for_user("user-1")

    response = client.post(
        "/api/personal-reference/search",
        json={
            "question": "安全服务 项目 模板 附件",
            "conversation_id": "conv-1",
            "top_k": 8,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    source_names = {source["file_name"] for source in body["sources"]}
    assert source_names == {"我的项目模板.txt", "当前会议附件.txt"}
    assert {source["file_id"] for source in body["sources"]} == {
        owner_reference.uuid,
        session_attachment.uuid,
    }
    assert {source["source_kind"] for source in body["sources"]} == {
        "personal_reference",
        "session_attachment",
    }


def test_personal_reference_generate_marks_current_session_attachment_notice(
    client_for_user,
    generation_db,
) -> None:
    from sqlalchemy import select

    from app.models import KnowledgeSearchLog

    session_attachment = _add_personal_file(
        generation_db,
        user_id="user-1",
        name="当前会议附件.txt",
        text="一、会议附件\n当前会话附件包含验收安排和责任人。",
        conversation_id="conv-attachment",
        usage_type="session_attachment",
    )
    _add_personal_file(
        generation_db,
        user_id="user-1",
        name="其他会话附件.txt",
        text="一、其他附件\n其他会话附件不应参与生成。",
        conversation_id="conv-other",
        usage_type="session_attachment",
    )
    client = client_for_user("user-1")

    response = client.post(
        "/api/personal-reference/generate",
        json={
            "question": "参考当前附件生成纪要",
            "mode": "normal",
            "conversation_id": "conv-attachment",
            "top_k": 6,
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["notice"] == "该内容参考当前会话附件生成，仅供本次会话使用。"
    assert body["sources"] == [
        {
            "source_kind": "session_attachment",
            "file_id": session_attachment.uuid,
            "file_name": "当前会议附件.txt",
            "chunk_id": body["sources"][0]["chunk_id"],
            "page_number": None,
            "section_title": "一、会议附件",
            "chunk_index": 0,
            "score": body["sources"][0]["score"],
            "snippet": "一、会议附件\n当前会话附件包含验收安排和责任人。",
        }
    ]
    assert "其他会话附件" not in body["messages"][0]["content"]
    logs = generation_db.execute(
        select(KnowledgeSearchLog).order_by(KnowledgeSearchLog.id.desc())
    ).scalars().all()
    assert logs[0].search_type == "session_attachment"


def test_personal_reference_generate_reports_when_no_reference_material_found(
    client_for_user,
) -> None:
    client = client_for_user("user-1")

    response = client.post(
        "/api/personal-reference/generate",
        json={
            "question": "参考我的资料生成会议纪要",
            "mode": "normal",
            "top_k": 6,
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["sources"] == []
    assert body["notice"] == "当前未检索到个人参考资料或当前会话附件。"
    assert "当前未检索到个人参考资料或当前会话附件" in body["messages"][0]["content"]
