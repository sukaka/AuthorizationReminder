import os

from app.crypto import ContentCipher
from app.knowledge_files import create_knowledge_file_from_bytes


def _cipher() -> ContentCipher:
    return ContentCipher(os.environ["CONTENT_ENCRYPTION_KEY"])


def _add_file(
    db,
    *,
    user_id: str,
    name: str,
    text: str,
    visibility: str = "PRIVATE",
    usage_type: str = "personal_reference",
    review_status: str = "draft",
    rag_enabled: bool = False,
    reference_enabled: bool = True,
    rag_scope: str = "personal",
    permission_scope: str = "private",
    conversation_id: str = "",
):
    file_record, chunks = create_knowledge_file_from_bytes(
        db,
        sso_user_id=user_id,
        file_name=name,
        content=text.encode("utf-8"),
        content_type="text/plain",
        cipher=_cipher(),
        key_version="v1",
        visibility=visibility,
        source_type="admin_upload" if usage_type == "official_knowledge" else "user_upload",
        usage_type=usage_type,
        review_status=review_status,
        rag_enabled=rag_enabled,
        reference_enabled=reference_enabled,
        rag_scope=rag_scope,
        permission_scope=permission_scope,
        owner_user_id=user_id,
        conversation_id=conversation_id,
        target_chars=200,
        max_chars=300,
        overlap_chars=0,
    )
    db.commit()
    return file_record, chunks


def test_official_search_retrieves_only_approved_enabled_official_chunks(generation_db) -> None:
    from app.knowledge_search import search_knowledge_chunks

    _add_file(
        generation_db,
        user_id="user-1",
        name="个人白皮书.txt",
        text="一、服务说明\n聚信安全服务覆盖应急响应和合规检查。",
    )
    official_file, _ = _add_file(
        generation_db,
        user_id="admin",
        name="公司公共资料.txt",
        text="一、公共能力\n公司安全服务包含渗透测试和安全培训。",
        visibility="PUBLIC",
        usage_type="official_knowledge",
        review_status="official",
        rag_enabled=True,
        rag_scope="company",
        permission_scope="company",
    )
    _add_file(
        generation_db,
        user_id="user-2",
        name="他人私有资料.txt",
        text="一、私有能力\n安全服务报价仅他人可见。",
    )
    _add_file(
        generation_db,
        user_id="admin",
        name="待审核资料.txt",
        text="一、待审核能力\n安全服务包含未审核说明。",
        visibility="PUBLIC",
        usage_type="official_knowledge",
        review_status="pending",
        rag_enabled=True,
        rag_scope="company",
        permission_scope="company",
    )
    _add_file(
        generation_db,
        user_id="admin",
        name="未启用RAG资料.txt",
        text="一、未启用能力\n安全服务包含未启用说明。",
        visibility="PUBLIC",
        usage_type="official_knowledge",
        review_status="official",
        rag_enabled=False,
        rag_scope="company",
        permission_scope="company",
    )

    results = search_knowledge_chunks(
        generation_db,
        sso_user_id="user-1",
        query="安全 服务",
        cipher=_cipher(),
    )

    assert {result.file_uuid for result in results} == {official_file.uuid}
    assert all("个人白皮书" not in result.file_name for result in results)
    assert all("他人私有" not in result.file_name for result in results)
    assert all("待审核" not in result.file_name for result in results)
    assert all("未启用RAG" not in result.file_name for result in results)
    assert all(result.chunk_text for result in results)
    assert all(result.score > 0 for result in results)


def test_official_search_updates_document_usage_stats(generation_db) -> None:
    from app.knowledge_search import search_knowledge_chunks

    official_file, _ = _add_file(
        generation_db,
        user_id="admin",
        name="公司安全服务资料.txt",
        text="一、安全服务\n公司安全服务包含应急响应和安全培训。",
        visibility="PUBLIC",
        usage_type="official_knowledge",
        review_status="official",
        rag_enabled=True,
        rag_scope="company",
        permission_scope="company",
    )

    results = search_knowledge_chunks(
        generation_db,
        sso_user_id="user-1",
        query="安全 服务",
        cipher=_cipher(),
    )

    assert results
    generation_db.refresh(official_file)
    assert official_file.usage_count == 1
    assert official_file.last_used_at is not None


def test_official_search_uses_company_rag_scope_by_default(generation_db) -> None:
    from app.knowledge_search import search_knowledge_chunks

    company_file, _ = _add_file(
        generation_db,
        user_id="admin",
        name="公司安全服务资料.txt",
        text="一、安全服务\n公司安全服务包含应急响应。",
        visibility="PUBLIC",
        usage_type="official_knowledge",
        review_status="official",
        rag_enabled=True,
        rag_scope="company",
        permission_scope="company",
    )
    _add_file(
        generation_db,
        user_id="admin",
        name="项目安全服务资料.txt",
        text="一、安全服务\n项目安全服务包含专属客户承诺。",
        visibility="PUBLIC",
        usage_type="official_knowledge",
        review_status="official",
        rag_enabled=True,
        rag_scope="project",
        permission_scope="project",
    )
    _add_file(
        generation_db,
        user_id="admin",
        name="管理员安全服务资料.txt",
        text="一、安全服务\n管理员安全服务包含内部配置说明。",
        visibility="PUBLIC",
        usage_type="official_knowledge",
        review_status="official",
        rag_enabled=True,
        rag_scope="company",
        permission_scope="admin",
    )

    results = search_knowledge_chunks(
        generation_db,
        sso_user_id="user-1",
        query="安全 服务",
        cipher=_cipher(),
    )

    assert {result.file_uuid for result in results} == {company_file.uuid}
    assert all("专属客户承诺" not in result.chunk_text for result in results)
    assert all("内部配置说明" not in result.chunk_text for result in results)


def test_personal_reference_search_retrieves_owner_reference_and_current_session_only(
    generation_db,
) -> None:
    from app.knowledge_search import search_personal_reference_chunks

    personal_file, _ = _add_file(
        generation_db,
        user_id="user-1",
        name="我的会议模板.txt",
        text="一、会议纪要\n安全服务会议纪要模板。",
    )
    session_file, _ = _add_file(
        generation_db,
        user_id="user-1",
        name="当前会议记录.txt",
        text="一、会议记录\n安全服务交付讨论记录。",
        usage_type="session_attachment",
        rag_scope="session",
        conversation_id="conv-1",
    )
    _add_file(
        generation_db,
        user_id="user-1",
        name="其他会话附件.txt",
        text="一、其他记录\n安全服务其他会话记录。",
        usage_type="session_attachment",
        rag_scope="session",
        conversation_id="conv-2",
    )
    _add_file(
        generation_db,
        user_id="user-2",
        name="他人个人资料.txt",
        text="一、他人资料\n安全服务他人模板。",
    )

    results = search_personal_reference_chunks(
        generation_db,
        sso_user_id="user-1",
        query="安全 服务",
        cipher=_cipher(),
        conversation_id="conv-1",
    )

    assert {result.file_uuid for result in results} == {
        personal_file.uuid,
        session_file.uuid,
    }
    assert all("其他会话" not in result.file_name for result in results)
    assert all("他人个人资料" not in result.file_name for result in results)


def test_personal_reference_search_updates_document_usage_stats(generation_db) -> None:
    from app.knowledge_search import search_personal_reference_chunks

    personal_file, _ = _add_file(
        generation_db,
        user_id="user-1",
        name="我的会议模板.txt",
        text="一、会议纪要\n安全服务会议纪要模板。",
    )
    session_file, _ = _add_file(
        generation_db,
        user_id="user-1",
        name="当前会议记录.txt",
        text="一、会议记录\n安全服务交付讨论记录。",
        usage_type="session_attachment",
        rag_scope="session",
        conversation_id="conv-1",
    )

    results = search_personal_reference_chunks(
        generation_db,
        sso_user_id="user-1",
        query="安全 服务",
        cipher=_cipher(),
        conversation_id="conv-1",
    )

    assert {result.file_uuid for result in results} == {
        personal_file.uuid,
        session_file.uuid,
    }
    generation_db.refresh(personal_file)
    generation_db.refresh(session_file)
    assert personal_file.usage_count == 1
    assert session_file.usage_count == 1
    assert personal_file.last_used_at is not None
    assert session_file.last_used_at is not None


def test_search_clamps_top_k_between_five_and_ten(generation_db) -> None:
    from app.knowledge_search import search_knowledge_chunks

    for index in range(7):
        _add_file(
            generation_db,
            user_id="user-1",
            name=f"资料-{index}.txt",
            text=f"一、安全服务\n第 {index} 份资料说明安全服务流程。",
            visibility="PUBLIC",
            usage_type="official_knowledge",
            review_status="official",
            rag_enabled=True,
            rag_scope="company",
            permission_scope="company",
        )

    low_top_k_results = search_knowledge_chunks(
        generation_db,
        sso_user_id="user-1",
        query="安全 服务",
        cipher=_cipher(),
        top_k=2,
    )
    high_top_k_results = search_knowledge_chunks(
        generation_db,
        sso_user_id="user-1",
        query="安全 服务",
        cipher=_cipher(),
        top_k=99,
    )

    assert len(low_top_k_results) == 5
    assert len(high_top_k_results) == 7


def test_search_returns_empty_when_no_chunk_matches(generation_db) -> None:
    from app.knowledge_search import search_knowledge_chunks

    _add_file(
        generation_db,
        user_id="user-1",
        name="会议纪要.txt",
        text="一、会议安排\n周五下午召开内部会议。",
        visibility="PUBLIC",
        usage_type="official_knowledge",
        review_status="official",
        rag_enabled=True,
        rag_scope="company",
        permission_scope="company",
    )

    results = search_knowledge_chunks(
        generation_db,
        sso_user_id="user-1",
        query="不存在的客户报价",
        cipher=_cipher(),
    )

    assert results == []
