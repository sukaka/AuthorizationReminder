import os

import pytest

from app.crypto import ContentCipher
from app.knowledge_files import create_knowledge_file_from_bytes


def _cipher() -> ContentCipher:
    return ContentCipher(os.environ["CONTENT_ENCRYPTION_KEY"])


def test_top_k_limit_respects_supported_request_size() -> None:
    from app.knowledge_search import _clamp_top_k
    from app.schemas import ChatPrepareIn, KnowledgeQueryIn

    assert _clamp_top_k(1) == 1
    assert _clamp_top_k(3) == 3
    assert _clamp_top_k(8) == 8
    with pytest.raises(ValueError):
        ChatPrepareIn(question="查询资料", top_k=9)
    with pytest.raises(ValueError):
        KnowledgeQueryIn(question="查询资料", top_k=9)


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


def test_search_respects_low_top_k_and_caps_internal_limit_at_eight(generation_db) -> None:
    from app.knowledge_search import search_knowledge_chunks

    for index in range(10):
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

    assert len(low_top_k_results) == 2
    assert len(high_top_k_results) == 8


def test_search_balances_top_chunks_across_relevant_files(generation_db) -> None:
    from collections import Counter

    from app.knowledge_search import search_knowledge_chunks

    dominant_text = "\n\n".join(
        f"{index}、责任归属\n未知云安全设施责任归属需要结合客户、云服务商和交付方的边界确认。"
        + "设施清单和责任矩阵应在项目交付阶段逐项核对。" * 4
        for index in range(10)
    )
    _add_file(
        generation_db,
        user_id="admin",
        name="大型建设方案.txt",
        text=dominant_text,
        visibility="PUBLIC",
        usage_type="official_knowledge",
        review_status="official",
        rag_enabled=True,
        rag_scope="company",
        permission_scope="company",
    )
    for index in range(3):
        _add_file(
            generation_db,
            user_id="admin",
            name=f"责任说明-{index}.txt",
            text=(
                "一、责任说明\n未知云安全设施责任归属由责任矩阵确认。"
                + f"第 {index} 份资料补充客户与服务商边界。" * 20
            ),
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
        query="未知云安全设施责任归属",
        cipher=_cipher(),
        top_k=8,
    )

    counts = Counter(result.file_uuid for result in results)
    assert len(results) == 8
    assert len(counts) >= 3
    assert max(counts.values()) <= 3


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


def test_personal_reference_search_ignores_unrelated_uploads(generation_db) -> None:
    from app.knowledge_search import search_personal_reference_chunks

    _add_file(
        generation_db,
        user_id="user-1",
        name="山东枣庄烟草招标文件.txt",
        text="三、获取招标文件\n投标人应在截止时间前提交澄清问题，并按照招标代理机构要求领取招标文件。",
    )

    results = search_personal_reference_chunks(
        generation_db,
        sso_user_id="user-1",
        query="你是谁",
        cipher=_cipher(),
        include_personal_references=True,
    )

    assert results == []


def test_hybrid_search_returns_structured_sheet_metadata_for_product_terms(generation_db) -> None:
    from app.knowledge_search import search_knowledge_chunks

    product_file, chunks = _add_file(
        generation_db,
        user_id="admin",
        name="产品参数.txt",
        text="产品参数\n型号：WDSP-200\n管理端口：8443\n标准号：GB/T 22239",
        visibility="PUBLIC",
        usage_type="official_knowledge",
        review_status="official",
        rag_enabled=True,
        rag_scope="company",
        permission_scope="company",
    )
    chunks[0].section_title = "产品参数"
    chunks[0].metadata_json = {
        **(chunks[0].metadata_json or {}),
        "section_path": "产品参数",
        "page_or_sheet": "参数Sheet",
        "chunk_type": "sheet_rows",
        "keywords": ["WDSP-200", "8443", "GB/T 22239"],
    }
    _add_file(
        generation_db,
        user_id="admin",
        name="通用安全服务.txt",
        text="安全服务 安全服务 安全服务 安全服务 安全服务，不包含产品型号。",
        visibility="PUBLIC",
        usage_type="official_knowledge",
        review_status="official",
        rag_enabled=True,
        rag_scope="company",
        permission_scope="company",
    )
    generation_db.commit()

    results = search_knowledge_chunks(
        generation_db,
        sso_user_id="user-1",
        query="WDSP-200 8443",
        cipher=_cipher(),
        top_k=8,
    )

    assert results
    assert results[0].file_uuid == product_file.uuid
    assert results[0].section_path == "产品参数"
    assert results[0].page_or_sheet == "参数Sheet"
    assert results[0].chunk_type == "sheet_rows"
    assert results[0].score > 0


def test_hybrid_search_limits_final_context_to_top_eight(generation_db) -> None:
    from app.knowledge_search import search_knowledge_chunks

    for index in range(12):
        _add_file(
            generation_db,
            user_id="admin",
            name=f"候选资料-{index}.txt",
            text=f"一、安全服务\n候选 {index} 包含安全服务、产品型号 WDSP 和端口 8443。",
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
        query="安全服务 WDSP 8443",
        cipher=_cipher(),
        top_k=30,
    )

    assert len(results) == 8
    assert len({result.chunk_id for result in results}) == len(results)


def test_hybrid_retriever_merges_vector_only_and_bm25_candidates(generation_db) -> None:
    from app.knowledge_search import EmbeddingService, search_knowledge_chunks

    embedding_service = EmbeddingService()
    vector_file, vector_chunks = _add_file(
        generation_db,
        user_id="admin",
        name="语义召回资料.txt",
        text="一、售后流程\n客户售后巡检按月执行，未直接写入查询关键词。",
        visibility="PUBLIC",
        usage_type="official_knowledge",
        review_status="official",
        rag_enabled=True,
        rag_scope="company",
        permission_scope="company",
    )
    vector_embedding = embedding_service.embed("零信任网关")
    vector_chunks[0].metadata_json = {
        **(vector_chunks[0].metadata_json or {}),
        "embedding": embedding_service.to_metadata(vector_embedding),
    }
    vector_chunks[0].embedding_id = embedding_service.embedding_id(
        vector_chunks[0].chunk_id,
        vector_embedding,
    )
    bm25_file, _bm25_chunks = _add_file(
        generation_db,
        user_id="admin",
        name="关键词资料.txt",
        text="一、安全服务\n安全服务包含巡检、加固和应急响应。",
        visibility="PUBLIC",
        usage_type="official_knowledge",
        review_status="official",
        rag_enabled=True,
        rag_scope="company",
        permission_scope="company",
    )
    generation_db.commit()

    results = search_knowledge_chunks(
        generation_db,
        sso_user_id="user-1",
        query="零信任网关 安全服务",
        cipher=_cipher(),
        top_k=8,
    )

    file_ids = {result.file_uuid for result in results}
    assert vector_file.uuid in file_ids
    assert bm25_file.uuid in file_ids
    assert len({result.chunk_id for result in results}) == len(results)
