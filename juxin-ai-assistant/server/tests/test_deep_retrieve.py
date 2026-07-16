from app.agent_runtime.deep_retrieve import (
    build_citation_cards,
    classify_query,
    deep_retrieve,
    no_evidence_answer,
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
