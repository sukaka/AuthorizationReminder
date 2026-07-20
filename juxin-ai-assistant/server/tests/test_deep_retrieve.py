from app.agent_runtime.deep_retrieve import (
    DeepRetrievalResult,
    build_citation_cards,
    classify_query,
    deep_retrieve,
    grade_retrieved_snippets,
    no_evidence_answer,
    rewrite_retrieval_query,
)
from app.agent_runtime.answer_engine import DefaultAnswerEngine, RetrievedSnippet
from app.agent_runtime.native_runtime import NativeRuntime
from app.agent_runtime.protocol import RunRequest
from app.agent_run_service import AgentRunService
from app.crypto import ContentCipher
from app.models import KnowledgeFile
import base64


def _cipher() -> ContentCipher:
    return ContentCipher(base64.urlsafe_b64encode(b"k" * 32).decode("ascii"))


def test_classify_query_modes() -> None:
    assert classify_query("VPN 如何申请").mode == "precise"
    assert classify_query("请汇总多份方案生成报告").mode == "summary"
    assert classify_query("对比两个版本差异").mode == "compare"


def test_retrieval_grade_is_explainable_and_bounded() -> None:
    grade = grade_retrieved_snippets(
        "WDSP 部署和验收",
        [
            RetrievedSnippet(
                name="WDSP实施指南.pdf",
                text="部署步骤、验收条件和回滚要求均在本章节说明。" * 4,
                file_uuid="f1",
            ),
            RetrievedSnippet(name="验收清单.docx", text="验收清单。", file_uuid="f2"),
        ],
    )
    assert grade.relevant is True
    assert 0.0 <= grade.query_term_coverage <= 1.0
    assert grade.file_coverage == 2
    assert "no_results" not in grade.reasons


def test_rewrite_retrieval_query_keeps_original_and_adds_aliases() -> None:
    rewritten = rewrite_retrieval_query("WDSP 部署如何验收", ["交付验收"])
    assert rewritten.startswith("WDSP 部署如何验收")
    assert "WEB动态安全管理平台" in rewritten
    assert "交付验收" in rewritten


def test_answer_engine_exposes_retrieval_quality_metadata() -> None:
    engine = DefaultAnswerEngine()
    engine.last_retrieval = DeepRetrievalResult(
        snippets=[],
        mode="precise",
        primary_hits=1,
        secondary_hits=1,
        file_coverage=2,
        expanded_terms=["交付验收"],
        second_pass_used=True,
        query_variants=["原问题", "原问题 交付验收"],
        retry_reason=["short_evidence"],
        retrieval_grade={"relevant": True},
    )
    _answer, _calls, meta = engine.generate("原问题", [])
    assert meta["query_variants"] == ["原问题", "原问题 交付验收"]
    assert meta["retry_reason"] == ["short_evidence"]
    assert meta["retrieval_grade"] == {"relevant": True}


def test_deep_retrieve_with_second_pass_and_coverage(generation_db) -> None:
    import importlib

    dr_mod = importlib.import_module("app.agent_runtime.deep_retrieve")

    calls: list[list[str]] = []

    def fake_search(db, *, query, terms, limit, owner_user_id):
        calls.append(list(terms))
        if len(calls) == 1:
            return [
                RetrievedSnippet(
                    name="等保实施指南.pdf",
                    text="等保",
                    location="资料库",
                    file_uuid="f1",
                )
            ]
        return [
            RetrievedSnippet(
                name="等级保护检查清单.docx",
                text="检查项覆盖物理环境、网络边界与访问控制。",
                location="资料库",
                file_uuid="f2",
            )
        ]

    original = dr_mod._lexical_search
    dr_mod._lexical_search = fake_search  # type: ignore[assignment]
    try:
        result = deep_retrieve(generation_db, "dev", "等保检查需要哪些要求以及边界防护")
        assert result.snippets
        assert result.second_pass_used is True
        assert result.secondary_hits >= 1
        assert result.file_coverage >= 1
        assert isinstance(result.expanded_terms, list)
        assert result.retry_reason
        assert len(calls) >= 2
    finally:
        dr_mod._lexical_search = original  # type: ignore[assignment]


def test_no_evidence_refusal_path(generation_db) -> None:
    cipher = _cipher()
    service = AgentRunService(generation_db, cipher)
    engine = DefaultAnswerEngine(
        retrieve_fn=lambda *_a, **_k: [],
        generate_fn=None,  # use default synthesize
    )
    # rebind default generate
    from app.agent_runtime.answer_engine import synthesize_from_snippets

    engine = DefaultAnswerEngine(
        retrieve_fn=lambda *_a, **_k: [],
        generate_fn=synthesize_from_snippets,
    )
    row = service.create_run(owner_user_id="dev", input_text="完全不存在的制度XYZ")
    snap = NativeRuntime(generation_db, cipher, answer_engine=engine).start_sync(
        RunRequest(run_id=row.uuid, owner_user_id="dev", input_text="完全不存在的制度XYZ")
    )
    generation_db.refresh(row)
    assert snap.status == "succeeded"
    assert row.result_json["kind"] == "no_evidence_refusal"
    assert row.result_json.get("refused") is True
    assert "未找到明确依据" in row.result_json["answer"] or "无依据拒答" in row.result_json["answer"]


def test_citation_cards_mark_inference() -> None:
    cards = build_citation_cards(
        [
            RetrievedSnippet(name="a", text="必须完成双人复核。", location="P1", file_uuid="1"),
            RetrievedSnippet(name="b", text="建议可以考虑外包支持。", location="P2", file_uuid="2"),
        ]
    )
    assert cards[0]["is_inference"] is False
    assert cards[1]["is_inference"] is True
    assert cards[0]["name"] == "a"


def test_no_evidence_answer_text() -> None:
    text = no_evidence_answer("测试问题")
    assert "未找到明确依据" in text
    assert "无依据拒答" in text


def test_lexical_fallback_filters_private_files_at_sql_boundary(generation_db) -> None:
    import importlib

    dr_mod = importlib.import_module("app.agent_runtime.deep_retrieve")
    generation_db.add_all([
        KnowledgeFile(
            uuid="file-owner",
            sso_user_id="u-1",
            owner_user_id="u-1",
            file_name="u1-制度.pdf",
            original_file_name="u1-制度.pdf",
            file_type="application/pdf",
            file_size=1,
            summary="VPN 制度说明",
            content_sha256="a" * 64,
        ),
        KnowledgeFile(
            uuid="file-other",
            sso_user_id="u-2",
            owner_user_id="u-2",
            file_name="u2-制度.pdf",
            original_file_name="u2-制度.pdf",
            file_type="application/pdf",
            file_size=1,
            summary="VPN 制度说明",
            content_sha256="b" * 64,
        ),
        KnowledgeFile(
            uuid="file-official",
            sso_user_id="system",
            owner_user_id="system",
            file_name="公司-VPN-制度.pdf",
            original_file_name="公司-VPN-制度.pdf",
            file_type="application/pdf",
            file_size=1,
            summary="VPN 制度说明",
            usage_type="official_knowledge",
            review_status="approved",
            permission_scope="company",
            content_sha256="c" * 64,
        ),
    ])
    generation_db.commit()

    rows = dr_mod._lexical_search(
        generation_db,
        query="VPN 制度",
        terms=["vpn", "制度"],
        limit=10,
        owner_user_id="u-1",
    )

    assert {row.file_uuid for row in rows} == {"file-owner", "file-official"}
    assert "file-other" not in {row.file_uuid for row in rows}
