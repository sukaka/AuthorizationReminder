from __future__ import annotations

from zipfile import ZipFile
from types import SimpleNamespace

from app.agent_runtime import BaseTool, ToolContext, ToolRegistry, ToolResult


class EchoTool(BaseTool):
    name = "echo"
    description = "Echo input for registry tests"
    required_permission = "tools.echo"

    def run(self, tool_input: dict, context: ToolContext) -> ToolResult:
        return ToolResult(
            tool_name=self.name,
            payload={"echo": tool_input["text"], "user_id": context.user_id},
            output_summary={"echoed": True},
            source_count=1,
        )


class FailingTool(BaseTool):
    name = "failing"
    description = "Raise a controlled failure"

    def run(self, tool_input: dict, context: ToolContext) -> ToolResult:
        raise RuntimeError("upstream exploded with secret sk-hidden-value")


def test_tool_registry_executes_tool_and_writes_success_log(generation_db) -> None:
    from app.models import AgentToolCallLog

    registry = ToolRegistry()
    registry.register(EchoTool())

    result = registry.execute(
        "echo",
        {"text": "hello"},
        ToolContext(
            user_id="user-1",
            db=generation_db,
            permissions={"tools.echo"},
            mode="normal",
            conversation_id="conversation-1",
        ),
    )

    assert result.status == "success"
    assert result.payload == {"echo": "hello", "user_id": "user-1"}

    logs = generation_db.query(AgentToolCallLog).all()
    assert len(logs) == 1
    assert logs[0].tool_name == "echo"
    assert logs[0].user_id == "user-1"
    assert logs[0].conversation_id == "conversation-1"
    assert logs[0].status == "success"
    assert logs[0].source_count == 1
    assert logs[0].input_summary_json == {"text": "hello"}
    assert logs[0].output_summary_json == {"echoed": True}
    assert logs[0].latency_ms >= 0


def test_tool_registry_blocks_missing_permission_and_logs_denial(generation_db) -> None:
    from app.models import AgentToolCallLog

    registry = ToolRegistry()
    registry.register(EchoTool())

    result = registry.execute(
        "echo",
        {"text": "hello"},
        ToolContext(user_id="user-1", db=generation_db, permissions=set()),
    )

    assert result.status == "forbidden"
    assert result.error_code == "TOOL_PERMISSION_DENIED"
    assert result.payload == {}

    log = generation_db.query(AgentToolCallLog).one()
    assert log.tool_name == "echo"
    assert log.status == "forbidden"
    assert log.error_code == "TOOL_PERMISSION_DENIED"


def test_tool_registry_supports_disabled_tools_without_calling_them(generation_db) -> None:
    from app.models import AgentToolCallLog

    registry = ToolRegistry()
    registry.register(EchoTool(), enabled=False)

    result = registry.execute(
        "echo",
        {"text": "hello"},
        ToolContext(user_id="user-1", db=generation_db, permissions={"tools.echo"}),
    )

    assert result.status == "disabled"
    assert result.error_code == "TOOL_DISABLED"

    log = generation_db.query(AgentToolCallLog).one()
    assert log.tool_name == "echo"
    assert log.status == "disabled"
    assert log.error_code == "TOOL_DISABLED"


def test_tool_registry_sanitizes_unhandled_tool_errors(generation_db) -> None:
    from app.models import AgentToolCallLog

    registry = ToolRegistry()
    registry.register(FailingTool())

    result = registry.execute(
        "failing",
        {"text": "hello"},
        ToolContext(user_id="user-1", db=generation_db),
    )

    assert result.status == "error"
    assert result.error_code == "TOOL_EXECUTION_FAILED"
    assert "sk-hidden-value" not in result.error_message_safe

    log = generation_db.query(AgentToolCallLog).one()
    assert log.status == "error"
    assert log.error_code == "TOOL_EXECUTION_FAILED"
    assert "sk-hidden-value" not in log.error_message_safe


def test_agent_loop_tool_executor_logs_company_knowledge_tool_call(
    generation_db,
    monkeypatch,
) -> None:
    from app.agent_loop.tool_executor import ToolExecutor
    from app.crypto import ContentCipher
    from app.models import AgentToolCallLog

    def fake_search_knowledge_chunks(*args, **kwargs):
        assert kwargs["query"] == "等保要求"
        return []

    monkeypatch.setattr(
        "app.agent_runtime.tools.knowledge_tools.search_knowledge_chunks",
        fake_search_knowledge_chunks,
    )

    executor = ToolExecutor(
        db=generation_db,
        sso_user_id="user-1",
        cipher=ContentCipher("a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s="),
        top_k=5,
    )

    result = executor.search_knowledge_base("等保要求", mode="knowledge")

    assert result.name == "search_knowledge_base"
    assert result.error == ""
    log = generation_db.query(AgentToolCallLog).one()
    assert log.tool_name == "company_knowledge_search"
    assert log.user_id == "user-1"
    assert log.mode == "knowledge"
    assert log.status == "success"
    assert log.input_summary_json["query"] == "等保要求"
    assert log.output_summary_json == {"chunk_count": 0, "search_log_ids": []}


def test_agent_loop_tool_executor_searches_current_attachments_only(
    generation_db,
    monkeypatch,
) -> None:
    from app.agent_loop.tool_executor import ToolExecutor
    from app.crypto import ContentCipher
    from app.models import AgentToolCallLog, KnowledgeSearchLog

    def fake_search_personal_reference_chunks(*args, **kwargs):
        assert kwargs["query"] == "提取附件标题"
        assert kwargs["conversation_id"] == "conversation-1"
        assert kwargs["file_ids"] == ["file-session"]
        assert kwargs["include_personal_references"] is False
        assert kwargs["include_session_attachments"] is True
        return [
            SimpleNamespace(
                chunk_id="chunk-session",
                source_kind="session_attachment",
            )
        ]

    monkeypatch.setattr(
        "app.agent_runtime.tools.knowledge_tools.search_personal_reference_chunks",
        fake_search_personal_reference_chunks,
    )

    executor = ToolExecutor(
        db=generation_db,
        sso_user_id="user-1",
        cipher=ContentCipher("a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s="),
        top_k=5,
    )

    result = executor.search_current_attachments(
        "提取附件标题",
        mode="normal",
        conversation_id="conversation-1",
        file_ids=["file-session"],
    )

    assert result.name == "search_current_attachments"
    assert result.error == ""
    assert [chunk.chunk_id for chunk in result.chunks] == ["chunk-session"]

    tool_log = generation_db.query(AgentToolCallLog).one()
    assert tool_log.tool_name == "current_attachment_search"
    assert tool_log.user_id == "user-1"
    assert tool_log.conversation_id == "conversation-1"
    assert tool_log.source_count == 1

    search_log = generation_db.query(KnowledgeSearchLog).one()
    assert search_log.search_type == "session_attachment"
    assert search_log.retrieved_chunk_ids_json == ["chunk-session"]


def test_word_export_tool_wraps_existing_docx_export_service(
    generation_db,
    monkeypatch,
) -> None:
    from app.agent_runtime.tools import WordExportTool
    from app.crypto import ContentCipher
    from app.models import AgentToolCallLog
    from app.schemas import ExportWordOut

    called = {}

    def fake_export_word(self, db, *, body, sso_user_id, username, department, cipher):
        called["conversation_id"] = body.conversation_id
        called["export_type"] = body.export_type
        called["sso_user_id"] = sso_user_id
        called["username"] = username
        called["department"] = department
        called["cipher"] = cipher
        return ExportWordOut(
            file_name="AI 对话导出.docx",
            download_url="/api/export/download/export-1",
        )

    monkeypatch.setattr(
        "app.agent_runtime.tools.export_tools.DocxExportService.export_word",
        fake_export_word,
    )
    registry = ToolRegistry()
    registry.register(WordExportTool())
    cipher = ContentCipher("a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s=")

    result = registry.execute(
        "word_export",
        {
            "body": {
                "conversation_id": "conversation-1",
                "message_id": "message-1",
                "export_type": "single_answer",
            },
            "username": "张雷",
            "department": "产品部",
        },
        ToolContext(
            user_id="user-1",
            db=generation_db,
            resources={"cipher": cipher, "file_manager": object()},
            mode="normal",
            conversation_id="conversation-1",
        ),
    )

    assert result.status == "success"
    assert result.payload["export"].file_name == "AI 对话导出.docx"
    assert called == {
        "conversation_id": "conversation-1",
        "export_type": "single_answer",
        "sso_user_id": "user-1",
        "username": "张雷",
        "department": "产品部",
        "cipher": cipher,
    }

    log = generation_db.query(AgentToolCallLog).one()
    assert log.tool_name == "word_export"
    assert log.status == "success"
    assert log.output_summary_json == {
        "file_name": "AI 对话导出.docx",
        "download_url": "/api/export/download/export-1",
    }


def test_pptx_export_tool_generates_valid_presentation_file(generation_db, tmp_path) -> None:
    from app.agent_runtime.tools import PptxExportTool
    from app.export_file_manager import ExportFileManager
    from app.models import AgentToolCallLog

    registry = ToolRegistry()
    registry.register(PptxExportTool())
    file_manager = ExportFileManager(str(tmp_path))

    result = registry.execute(
        "pptx_export",
        {
            "title": "聚信安全运维方案",
            "slides": [
                {"title": "方案目标", "bullets": ["巡检", "加固", "应急响应"]},
                {"title": "交付成果", "bullets": ["巡检报告", "整改清单"]},
            ],
        },
        ToolContext(
            user_id="user-1",
            db=generation_db,
            resources={"file_manager": file_manager},
        ),
    )

    assert result.status == "success"
    assert result.payload["file_name"].endswith(".pptx")
    pptx_path = tmp_path / f"{result.payload['file_id']}.pptx"
    assert pptx_path.exists()
    with ZipFile(pptx_path) as archive:
        names = set(archive.namelist())
        assert "ppt/presentation.xml" in names
        assert "ppt/slides/slide1.xml" in names
        assert "ppt/slides/slide2.xml" in names
        slide_text = archive.read("ppt/slides/slide1.xml").decode("utf-8")
        assert "方案目标" in slide_text
        assert "应急响应" in slide_text
    log = generation_db.query(AgentToolCallLog).one()
    assert log.tool_name == "pptx_export"
    assert log.output_summary_json["slide_count"] == 2


def _create_review_file(generation_db, *, owner_user_id: str = "user-1"):
    from app.models import KnowledgeFile

    file_record = KnowledgeFile(
        sso_user_id=owner_user_id,
        owner_user_id=owner_user_id,
        uploaded_by=owner_user_id,
        file_name="产品方案.md",
        original_file_name="产品方案.md",
        file_type="text/markdown",
        file_size=128,
        content_sha256=f"sha-review-{owner_user_id}",
        key_version="v1",
    )
    generation_db.add(file_record)
    generation_db.flush()
    return file_record


def test_knowledge_review_submit_tool_marks_personal_file_pending(
    generation_db,
) -> None:
    from app.agent_runtime.tools import KnowledgeReviewSubmitTool
    from app.models import AgentToolCallLog, KnowledgeReviewLog

    file_record = _create_review_file(generation_db)
    registry = ToolRegistry()
    registry.register(KnowledgeReviewSubmitTool())

    result = registry.execute(
        "knowledge_review_submit",
        {"file_id": file_record.uuid, "comment": "建议加入正式资料"},
        ToolContext(user_id="user-1", db=generation_db),
    )

    assert result.status == "success"
    assert result.payload == {
        "file_uuid": file_record.uuid,
        "review_status": "pending",
        "usage_type": "personal_reference",
        "rag_enabled": False,
    }
    assert file_record.review_status == "pending"
    assert file_record.review_comment == "建议加入正式资料"

    review_log = generation_db.query(KnowledgeReviewLog).one()
    assert review_log.action == "submit_review"
    assert review_log.user_id == "user-1"
    assert review_log.old_status == "draft"
    assert review_log.new_status == "pending"

    tool_log = generation_db.query(AgentToolCallLog).one()
    assert tool_log.tool_name == "knowledge_review_submit"
    assert tool_log.status == "success"
    assert tool_log.source_count == 1


def test_knowledge_review_approve_tool_promotes_pending_file_to_official(
    generation_db,
) -> None:
    from app.agent_runtime.tools import KnowledgeReviewApproveTool
    from app.models import AgentToolCallLog, KnowledgeBase, KnowledgeChunk, KnowledgeReviewLog

    file_record = _create_review_file(generation_db)
    file_record.review_status = "pending"
    base = KnowledgeBase(name="公司知识库", scope="company", created_by="admin-1")
    generation_db.add(base)
    generation_db.flush()
    chunk = KnowledgeChunk(
        chunk_id="chunk-review-1",
        file_id=file_record.id,
        knowledge_base_id=None,
        file_name=file_record.file_name,
        chunk_text_ciphertext=b"cipher",
        chunk_text_nonce=b"nonce",
        chunk_index=0,
        metadata_json={},
    )
    generation_db.add(chunk)
    generation_db.flush()
    registry = ToolRegistry()
    registry.register(KnowledgeReviewApproveTool())

    result = registry.execute(
        "knowledge_review_approve",
        {
            "file_id": file_record.uuid,
            "knowledge_base_id": base.uuid,
            "comment": "审核通过",
            "permission_scope": "company",
            "rag_scope": "company",
            "category": "产品资料",
            "document_type": "产品白皮书",
            "tags": ["WDSP"],
        },
        ToolContext(
            user_id="admin-1",
            db=generation_db,
            permissions={"knowledge.review.manage"},
        ),
    )

    assert result.status == "success"
    assert result.payload["file_uuid"] == file_record.uuid
    assert result.payload["review_status"] == "official"
    assert result.payload["usage_type"] == "official_knowledge"
    assert file_record.knowledge_base_id == base.id
    assert file_record.rag_enabled is True
    assert file_record.reference_enabled is True
    assert file_record.rag_scope == "company"
    assert file_record.permission_scope == "company"
    assert file_record.visibility == "PUBLIC"
    assert file_record.category == "产品资料"
    assert file_record.document_type == "产品白皮书"
    assert file_record.tags_json == ["WDSP"]
    assert file_record.reviewed_by == "admin-1"
    assert file_record.reviewed_at is not None
    assert chunk.knowledge_base_id == base.id
    assert chunk.metadata_json["source_type"] == "official_knowledge"
    assert chunk.metadata_json["review_status"] == "official"

    review_log = generation_db.query(KnowledgeReviewLog).one()
    assert review_log.action == "approve"
    assert review_log.reviewer_id == "admin-1"
    assert review_log.new_status == "official"

    tool_log = generation_db.query(AgentToolCallLog).one()
    assert tool_log.tool_name == "knowledge_review_approve"
    assert tool_log.permission == "knowledge.review.manage"
    assert tool_log.status == "success"
    assert tool_log.source_count == 1


def test_knowledge_review_reject_tool_keeps_file_personal(
    generation_db,
) -> None:
    from app.agent_runtime.tools import KnowledgeReviewRejectTool
    from app.models import AgentToolCallLog, KnowledgeReviewLog

    file_record = _create_review_file(generation_db)
    file_record.review_status = "pending"
    file_record.rag_enabled = True
    registry = ToolRegistry()
    registry.register(KnowledgeReviewRejectTool())

    result = registry.execute(
        "knowledge_review_reject",
        {"file_id": file_record.uuid, "comment": "资料依据不足"},
        ToolContext(
            user_id="admin-1",
            db=generation_db,
            permissions={"knowledge.review.manage"},
        ),
    )

    assert result.status == "success"
    assert result.payload == {
        "file_uuid": file_record.uuid,
        "review_status": "rejected",
        "usage_type": "personal_reference",
        "rag_enabled": False,
    }
    assert file_record.review_status == "rejected"
    assert file_record.rag_scope == "personal"
    assert file_record.permission_scope == "private"
    assert file_record.visibility == "PRIVATE"
    assert file_record.reviewed_by == "admin-1"

    review_log = generation_db.query(KnowledgeReviewLog).one()
    assert review_log.action == "reject"
    assert review_log.reviewer_id == "admin-1"
    assert review_log.new_status == "rejected"

    tool_log = generation_db.query(AgentToolCallLog).one()
    assert tool_log.tool_name == "knowledge_review_reject"
    assert tool_log.status == "success"


def test_file_parse_tool_extracts_structured_chunks_without_persisting(
    generation_db,
) -> None:
    from app.agent_runtime.tools import FileParseTool
    from app.models import AgentToolCallLog, KnowledgeChunk, KnowledgeFile

    registry = ToolRegistry()
    registry.register(FileParseTool())

    result = registry.execute(
        "file_parse",
        {
            "file_name": "安全运维.md",
            "content_text": "一、服务目标\n保障客户业务系统稳定运行。\n二、输出成果\n形成运维月报。",
        },
        ToolContext(user_id="user-1", db=generation_db),
    )

    assert result.status == "success"
    assert result.payload["file_name"] == "安全运维.md"
    assert result.payload["chunk_count"] >= 2
    assert result.payload["chunks"][0]["chunk_index"] == 0
    assert result.payload["chunks"][0]["section_title"] == "一、服务目标"
    assert "保障客户业务系统" in result.payload["chunks"][0]["chunk_text"]
    assert generation_db.query(KnowledgeFile).count() == 0
    assert generation_db.query(KnowledgeChunk).count() == 0

    tool_log = generation_db.query(AgentToolCallLog).one()
    assert tool_log.tool_name == "file_parse"
    assert tool_log.status == "success"
    assert tool_log.source_count == result.payload["chunk_count"]


def test_reference_source_validate_tool_keeps_only_used_sources(
    generation_db,
) -> None:
    from app.agent_runtime.tools import ReferenceSourceValidateTool
    from app.models import AgentToolCallLog

    registry = ToolRegistry()
    registry.register(ReferenceSourceValidateTool())

    result = registry.execute(
        "reference_source_validate",
        {
            "answer": "根据《聚信等保合规云管平台-招标参数V1.1.docx》，可确认硬件参数章节存在。",
            "sources": [
                {
                    "source_type": "session_attachment",
                    "source_uuid": "file-used",
                    "file_name": "3-聚信等保合规云管平台-招标参数V1.1.docx",
                    "title": "3-聚信等保合规云管平台-招标参数V1.1.docx",
                    "chunk_id": "chunk-used",
                },
                {
                    "source_type": "official_knowledge",
                    "source_uuid": "file-unused",
                    "file_name": "WEB动态安全管理平台白皮书v3.1.docx",
                    "title": "WEB动态安全管理平台白皮书v3.1.docx",
                    "chunk_id": "chunk-unused",
                },
            ],
        },
        ToolContext(user_id="user-1", db=generation_db),
    )

    assert result.status == "success"
    assert result.payload["kept_count"] == 1
    assert result.payload["removed_count"] == 1
    assert result.payload["sources"] == [
        {
            "source_type": "session_attachment",
            "source_uuid": "file-used",
            "file_name": "3-聚信等保合规云管平台-招标参数V1.1.docx",
            "title": "3-聚信等保合规云管平台-招标参数V1.1.docx",
            "chunk_id": "chunk-used",
            "page_number": None,
            "section_title": "",
            "chunk_index": None,
            "score": 0,
        }
    ]

    tool_log = generation_db.query(AgentToolCallLog).one()
    assert tool_log.tool_name == "reference_source_validate"
    assert tool_log.status == "success"
    assert tool_log.source_count == 1


def test_task_mode_detect_tool_wraps_existing_task_analyzer(
    generation_db,
) -> None:
    from app.agent_runtime.tools import TaskModeDetectTool
    from app.models import AgentToolCallLog

    registry = ToolRegistry()
    registry.register(TaskModeDetectTool())

    result = registry.execute(
        "task_mode_detect",
        {
            "question": "帮我写一份安全运维服务方案",
            "mode": "normal",
        },
        ToolContext(user_id="user-1", db=generation_db),
    )

    assert result.status == "success"
    assert result.payload == {
        "mode": "normal",
        "task_type": "document_generation",
        "strategy": "single_turn",
        "needs_knowledge": True,
        "require_knowledge_evidence": True,
    }

    tool_log = generation_db.query(AgentToolCallLog).one()
    assert tool_log.tool_name == "task_mode_detect"
    assert tool_log.status == "success"
    assert tool_log.output_summary_json["task_type"] == "document_generation"


def test_document_structure_validate_tool_reports_missing_sections(
    generation_db,
) -> None:
    from app.agent_runtime.tools import DocumentStructureValidateTool
    from app.models import AgentToolCallLog

    registry = ToolRegistry()
    registry.register(DocumentStructureValidateTool())

    result = registry.execute(
        "document_structure_validate",
        {
            "content": "这是一个简单回答，只说可以提升安全性。",
            "document_type": "方案",
            "require_sources": True,
        },
        ToolContext(user_id="user-1", db=generation_db),
    )

    assert result.status == "success"
    assert result.payload["passed"] is False
    assert "缺少清晰标题或分节结构" in result.payload["issues"]
    assert "缺少建设目标或服务目标" in result.payload["issues"]
    assert "缺少引用来源或依据说明" in result.payload["issues"]

    tool_log = generation_db.query(AgentToolCallLog).one()
    assert tool_log.tool_name == "document_structure_validate"
    assert tool_log.output_summary_json["passed"] is False


def test_advanced_quality_score_tool_scores_juxin_context_structure_and_sources(
    generation_db,
) -> None:
    from app.agent_runtime.tools import AdvancedQualityScoreTool
    from app.models import AgentToolCallLog

    registry = ToolRegistry()
    registry.register(AdvancedQualityScoreTool())

    weak = registry.execute(
        "advanced_quality_score",
        {"answer": "这是一个通用回答。", "mode": "business", "used_knowledge": True},
        ToolContext(user_id="user-1", db=generation_db),
    )
    strong = registry.execute(
        "advanced_quality_score",
        {
            "answer": (
                "一、聚信得仁投标响应思路\n"
                "1. 围绕客户等保和安全运维场景整理响应文件。\n"
                "2. 根据《安全白皮书.docx》章节：服务范围，列出交付步骤和风险提醒。\n"
                "3. 涉及报价、合同和验收结论需人工复核。"
            ),
            "mode": "business",
            "used_knowledge": True,
        },
        ToolContext(user_id="user-1", db=generation_db),
    )

    assert weak.status == "success"
    assert weak.payload["passed"] is False
    assert weak.payload["score"] < 60
    assert "聚信语境不足" in weak.payload["issues"]
    assert "缺少引用来源" in weak.payload["issues"]
    assert strong.status == "success"
    assert strong.payload["passed"] is True
    assert strong.payload["score"] >= 80
    assert strong.payload["grade"] == "A"
    logs = generation_db.query(AgentToolCallLog).order_by(AgentToolCallLog.id).all()
    assert [log.tool_name for log in logs] == ["advanced_quality_score", "advanced_quality_score"]
    assert logs[-1].output_summary_json["score"] == strong.payload["score"]


def test_bulk_knowledge_governance_tool_suggests_cleanup_without_mutation(
    generation_db,
) -> None:
    from app.agent_runtime.tools import BulkKnowledgeGovernanceTool
    from app.models import AgentToolCallLog, KnowledgeFile

    generation_db.add_all([
        KnowledgeFile(
            sso_user_id="user-1",
            owner_user_id="user-1",
            file_name="WDSP产品白皮书.docx",
            file_type="docx",
            file_size=1024,
            category="其他",
            document_type="其他",
            tags_json=[],
            summary="",
            status="READY",
            parse_status="parsed",
            index_status="indexed",
            content_sha256="sha-1",
            key_version="v1",
        ),
        KnowledgeFile(
            sso_user_id="user-1",
            owner_user_id="user-1",
            file_name="项目验收报告.docx",
            file_type="docx",
            file_size=2048,
            category="项目交付",
            document_type="验收报告",
            tags_json=["验收"],
            summary="项目最终验收资料",
            status="READY",
            parse_status="parsed",
            index_status="indexed",
            content_sha256="sha-2",
            key_version="v1",
        ),
    ])
    generation_db.flush()

    registry = ToolRegistry()
    registry.register(BulkKnowledgeGovernanceTool())

    result = registry.execute(
        "bulk_knowledge_governance",
        {"limit": 20},
        ToolContext(user_id="user-1", db=generation_db),
    )

    assert result.status == "success"
    assert result.payload["scanned_count"] == 2
    assert result.payload["needs_action_count"] == 1
    suggestion = result.payload["suggestions"][0]
    assert suggestion["file_name"] == "WDSP产品白皮书.docx"
    assert suggestion["suggested_category"] == "产品资料"
    assert suggestion["suggested_document_type"] == "产品白皮书"
    assert "缺少摘要" in suggestion["issues"]
    assert generation_db.query(KnowledgeFile).filter_by(file_name="WDSP产品白皮书.docx").one().category == "其他"
    log = generation_db.query(AgentToolCallLog).order_by(AgentToolCallLog.id.desc()).first()
    assert log.tool_name == "bulk_knowledge_governance"
    assert log.output_summary_json["needs_action_count"] == 1


def test_external_vector_store_tool_reports_disabled_when_not_configured(
    generation_db,
    monkeypatch,
) -> None:
    from app.agent_runtime.tools import ExternalVectorStoreHealthTool
    from app.models import AgentToolCallLog

    monkeypatch.delenv("JUXIN_VECTOR_PROVIDER", raising=False)
    monkeypatch.delenv("JUXIN_VECTOR_URL", raising=False)
    registry = ToolRegistry()
    registry.register(ExternalVectorStoreHealthTool())

    result = registry.execute(
        "external_vector_store_health",
        {},
        ToolContext(user_id="user-1", db=generation_db),
    )

    assert result.status == "success"
    assert result.payload == {
        "configured": False,
        "provider": "local-json",
        "status": "disabled",
        "message": "未配置外部向量库，当前使用本地 JSON 向量检索",
    }
    log = generation_db.query(AgentToolCallLog).one()
    assert log.tool_name == "external_vector_store_health"
    assert log.output_summary_json["status"] == "disabled"


def test_protocol_adapter_status_tool_returns_mcp_and_a2a_manifest(generation_db) -> None:
    from app.agent_runtime.tools import ProtocolAdapterStatusTool
    from app.models import AgentToolCallLog

    registry = ToolRegistry()
    registry.register(ProtocolAdapterStatusTool())

    result = registry.execute(
        "protocol_adapter_status",
        {"protocols": ["mcp", "a2a"]},
        ToolContext(user_id="user-1", db=generation_db),
    )

    assert result.status == "success"
    assert result.payload["protocols"] == ["mcp", "a2a"]
    assert result.payload["status"] == "local_manifest_ready"
    assert "company_knowledge_search" in result.payload["tools"]
    assert "deep_web_research" in result.payload["tools"]
    assert result.payload["manifest"]["name"] == "juxin-ai-assistant"
    assert result.payload["manifest"]["capabilities"]["mcp"] is True
    assert result.payload["manifest"]["capabilities"]["a2a"] is True
    log = generation_db.query(AgentToolCallLog).one()
    assert log.tool_name == "protocol_adapter_status"
    assert log.output_summary_json["tool_count"] == len(result.payload["tools"])


def test_document_template_select_tool_uses_existing_template_registry(
    generation_db,
) -> None:
    from app.agent_runtime.tools import DocumentTemplateSelectTool
    from app.models import AgentToolCallLog

    registry = ToolRegistry()
    registry.register(DocumentTemplateSelectTool())

    result = registry.execute(
        "document_template_select",
        {
            "question": "根据会议记录生成会议纪要，整理待办事项",
            "task_type": "document_generation",
        },
        ToolContext(user_id="user-1", db=generation_db),
    )

    assert result.status == "success"
    assert result.payload["template_code"] == "meeting_minutes_v1"
    assert result.payload["template_name"] == "会议纪要模板"
    assert "待办事项表" in result.payload["fixed_headings"]

    tool_log = generation_db.query(AgentToolCallLog).one()
    assert tool_log.tool_name == "document_template_select"
    assert tool_log.output_summary_json["template_code"] == "meeting_minutes_v1"


def test_user_feedback_tool_wraps_existing_feedback_service(
    generation_db,
    completed_generation,
) -> None:
    from app.agent_runtime.tools import UserFeedbackTool
    from app.crypto import ContentCipher
    from app.models import AgentToolCallLog, FeedbackRecord

    cipher = ContentCipher("a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s=")
    registry = ToolRegistry()
    registry.register(UserFeedbackTool())

    result = registry.execute(
        "user_feedback",
        {
            "generation_uuid": completed_generation.uuid,
            "feedback_type": "OTHER",
            "content": "格式还需要更像正式交付文档",
        },
        ToolContext(
            user_id="dev",
            db=generation_db,
            resources={"cipher": cipher, "key_version": "v1"},
        ),
    )

    assert result.status == "success"
    assert result.payload["generation_uuid"] == completed_generation.uuid
    assert result.payload["feedback_type"] == "OTHER"
    row = generation_db.query(FeedbackRecord).one()
    assert row.feedback_type == "OTHER"
    assert "格式还需要".encode() not in row.content_ciphertext

    tool_log = generation_db.query(AgentToolCallLog).one()
    assert tool_log.tool_name == "user_feedback"
    assert tool_log.output_summary_json["feedback_type"] == "OTHER"


def test_web_search_tool_wraps_existing_search_service(
    generation_db,
    monkeypatch,
) -> None:
    from datetime import UTC, datetime

    from app.agent_runtime.tools import WebSearchTool
    from app.models import AgentToolCallLog
    from app.web_sources import WebSearchResult

    def fake_search(self, query: str, *, limit: int = 5, **kwargs):
        assert query == "等保 2.0 最新要求"
        assert limit == 3
        assert kwargs["db"] is generation_db
        assert kwargs["user_id"] == "user-1"
        return [
            WebSearchResult(
                title="等保 2.0 标准说明",
                url="https://example.com/gb",
                site_name="example.com",
                snippet="等保 2.0 相关公开资料",
                fetched_at=datetime(2026, 7, 4, tzinfo=UTC),
            )
        ]

    monkeypatch.setattr("app.agent_runtime.tools.web_tools.WebSearchService.search", fake_search)
    registry = ToolRegistry()
    registry.register(WebSearchTool())

    result = registry.execute(
        "web_search",
        {"query": "等保 2.0 最新要求", "limit": 3},
        ToolContext(user_id="user-1", db=generation_db),
    )

    assert result.status == "success"
    assert result.payload["results"][0]["title"] == "等保 2.0 标准说明"
    assert result.payload["context"].startswith("【联网搜索结果】")
    log = generation_db.query(AgentToolCallLog).one()
    assert log.tool_name == "web_search"
    assert log.source_count == 1


def test_web_capture_tool_creates_preview_without_saving_to_knowledge(
    generation_db,
    monkeypatch,
) -> None:
    from datetime import UTC, datetime

    from app.agent_runtime.tools import WebCaptureTool
    from app.models import AgentToolCallLog, KnowledgeFile, WebCapture
    from app.web_sources import ExtractedWebContent, WebFetchResult

    def fake_fetch(self, url: str) -> WebFetchResult:
        assert url == "https://example.com/wdsp"
        return WebFetchResult(
            url=url,
            final_url=url,
            status_code=200,
            content_type="text/html",
            content=b"<html>WDSP</html>",
            fetched_at=datetime(2026, 7, 4, tzinfo=UTC),
        )

    def fake_extract(self, fetch_result: WebFetchResult) -> ExtractedWebContent:
        return ExtractedWebContent(
            title="WDSP 产品介绍",
            site_name="example.com",
            description="应用安全防护",
            text="WDSP 支持 Web、API、小程序等应用安全防护。",
            summary="WDSP 应用安全防护资料",
            word_count=12,
        )

    monkeypatch.setattr("app.agent_runtime.tools.web_tools.WebFetcher.fetch", fake_fetch)
    monkeypatch.setattr("app.agent_runtime.tools.web_tools.ContentExtractor.extract", fake_extract)
    registry = ToolRegistry()
    registry.register(WebCaptureTool())

    result = registry.execute(
        "web_capture",
        {"url": "https://example.com/wdsp", "conversation_id": "conv-1"},
        ToolContext(user_id="user-1", db=generation_db, conversation_id="conv-1"),
    )

    assert result.status == "success"
    assert result.payload["title"] == "WDSP 产品介绍"
    assert result.payload["suggested_category"] == "产品资料"
    assert result.payload["scope"] == "确认前仅本次预览，不会写入正式知识库"
    assert generation_db.query(WebCapture).count() == 1
    assert generation_db.query(KnowledgeFile).count() == 0
    log = generation_db.query(AgentToolCallLog).one()
    assert log.tool_name == "web_capture"


def test_web_research_tool_plans_searches_and_returns_report_without_saving(
    generation_db,
    monkeypatch,
) -> None:
    from datetime import UTC, datetime

    from app.agent_runtime.tools import WebResearchTool
    from app.models import AgentToolCallLog, KnowledgeFile, WebSearchLog
    from app.web_sources import WebSearchResult

    queries: list[str] = []

    def fake_search(self, query: str, *, limit: int = 5, **kwargs):
        queries.append(query)
        assert limit == 2
        assert kwargs["db"] is generation_db
        assert kwargs["user_id"] == "user-1"
        return [
            WebSearchResult(
                title=f"{query} 公开资料",
                url=f"https://example.com/{len(queries)}",
                site_name="example.com",
                snippet=f"{query} 摘要",
                fetched_at=datetime(2026, 7, 4, tzinfo=UTC),
            )
        ]

    monkeypatch.setattr("app.agent_runtime.tools.web_tools.WebSearchService.search", fake_search)
    registry = ToolRegistry()
    registry.register(WebResearchTool())

    result = registry.execute(
        "web_research",
        {"topic": "调研等保合规云平台采购要点", "limit_per_question": 2},
        ToolContext(user_id="user-1", db=generation_db, conversation_id="conv-1"),
    )

    assert result.status == "success"
    assert 3 <= len(result.payload["questions"]) <= 5
    assert queries == result.payload["questions"]
    assert "联网调研报告" in result.payload["report"]
    assert "https://example.com/1" in result.payload["report"]
    assert result.payload["scope"] == "联网资料仅作为公开来源参考，需用户确认后才可保存。"
    assert generation_db.query(KnowledgeFile).count() == 0
    assert generation_db.query(WebSearchLog).count() == len(result.payload["questions"])
    log = generation_db.query(AgentToolCallLog).one()
    assert log.tool_name == "web_research"
    assert log.source_count == len(result.payload["sources"])


def test_deep_web_research_tool_deduplicates_sources_and_returns_risk_sections(
    generation_db,
    monkeypatch,
) -> None:
    from datetime import UTC, datetime

    from app.agent_runtime.tools import DeepWebResearchTool
    from app.models import AgentToolCallLog, KnowledgeFile, WebSearchLog
    from app.web_sources import WebSearchResult

    queries: list[str] = []

    def fake_search(self, query: str, *, limit: int = 5, **kwargs):
        queries.append(query)
        assert limit == 2
        return [
            WebSearchResult(
                title="等保公开资料",
                url="https://example.com/shared",
                site_name="example.com",
                snippet=f"{query} 摘要 A",
                fetched_at=datetime(2026, 7, 4, tzinfo=UTC),
            ),
            WebSearchResult(
                title=f"{query} 行业资料",
                url=f"https://example.com/{len(queries)}",
                site_name="example.com",
                snippet=f"{query} 摘要 B",
                fetched_at=datetime(2026, 7, 4, tzinfo=UTC),
            ),
        ]

    monkeypatch.setattr("app.agent_runtime.tools.web_tools.WebSearchService.search", fake_search)
    registry = ToolRegistry()
    registry.register(DeepWebResearchTool())

    result = registry.execute(
        "deep_web_research",
        {"topic": "等保合规云平台采购", "limit_per_question": 2},
        ToolContext(user_id="user-1", db=generation_db, conversation_id="conv-1"),
    )

    assert result.status == "success"
    assert len(result.payload["questions"]) >= 6
    assert len(result.payload["sources"]) == len({source["url"] for source in result.payload["sources"]})
    assert "深度联网调研报告" in result.payload["report"]
    assert "聚信落地建议" in result.payload["report"]
    assert "风险与待确认" in result.payload["report"]
    assert result.payload["scope"] == "深度联网资料仅作为公开来源参考，保存或入库前必须人工确认。"
    assert generation_db.query(KnowledgeFile).count() == 0
    assert generation_db.query(WebSearchLog).count() == len(result.payload["questions"])
    log = generation_db.query(AgentToolCallLog).one()
    assert log.tool_name == "deep_web_research"
    assert log.output_summary_json["unique_source_count"] == len(result.payload["sources"])


def test_personal_memory_tool_saves_and_lists_user_preferences(
    generation_db,
) -> None:
    from app.agent_runtime.tools import PersonalMemoryTool
    from app.models import AgentToolCallLog, UserMemory

    registry = ToolRegistry()
    registry.register(PersonalMemoryTool())

    saved = registry.execute(
        "personal_memory",
        {"action": "save", "content": "输出方案时先给结论，再给分阶段计划。", "memory_type": "preference", "priority": "medium"},
        ToolContext(user_id="user-1", db=generation_db),
    )
    high = registry.execute(
        "personal_memory",
        {"action": "save", "content": "不要把导出路径写入历史列表。", "priority": "high"},
        ToolContext(user_id="user-1", db=generation_db),
    )
    low = registry.execute(
        "personal_memory",
        {"action": "save", "content": "临时偏好：少用项目符号。", "priority": "low"},
        ToolContext(user_id="user-1", db=generation_db),
    )
    other = registry.execute(
        "personal_memory",
        {"action": "save", "content": "另一个用户的偏好"},
        ToolContext(user_id="user-2", db=generation_db),
    )
    listed = registry.execute(
        "personal_memory",
        {"action": "list"},
        ToolContext(user_id="user-1", db=generation_db),
    )

    assert saved.status == "success"
    assert high.status == "success"
    assert low.status == "success"
    assert other.status == "success"
    assert [item["content"] for item in listed.payload["memories"]] == [
        "不要把导出路径写入历史列表。",
        "输出方案时先给结论，再给分阶段计划。",
        "临时偏好：少用项目符号。",
    ]
    assert generation_db.query(UserMemory).count() == 4
    assert [log.tool_name for log in generation_db.query(AgentToolCallLog).order_by(AgentToolCallLog.id)] == [
        "personal_memory",
        "personal_memory",
        "personal_memory",
        "personal_memory",
        "personal_memory",
    ]


def test_learning_library_tool_saves_experience_template_and_failure_case(
    generation_db,
) -> None:
    from app.agent_runtime.tools import LearningLibraryTool
    from app.models import AgentToolCallLog, ExperienceLibrary, FailureCaseLibrary, TemplateLibrary

    registry = ToolRegistry()
    registry.register(LearningLibraryTool())

    experience = registry.execute(
        "learning_library",
        {
            "action": "save_experience",
            "task_type": "商务投标",
            "title": "投标响应结构",
            "question": "如何写投标响应？",
            "answer": "先列评分点，再列响应表。",
            "summary": "商务投标优先按评分点组织。",
            "tags": ["投标", "商务"],
        },
        ToolContext(user_id="user-1", db=generation_db),
    )
    template = registry.execute(
        "learning_library",
        {
            "action": "save_template",
            "template_name": "整改回复模板",
            "task_type": "风险评估审查",
            "template_content": "问题：{{issue}}\n整改：{{action}}",
            "variables": {"issue": "问题", "action": "整改动作"},
            "scope": "personal",
        },
        ToolContext(user_id="user-1", db=generation_db),
    )
    failure = registry.execute(
        "learning_library",
        {
            "action": "save_failure_case",
            "task_type": "Word导出",
            "wrong_answer": "把保存路径写入历史会话标题。",
            "correction": "导出成功只用 Toast。",
            "prevention_rule": "导出结果不得写入历史任务标题。",
            "tags": ["导出", "历史"],
        },
        ToolContext(user_id="user-1", db=generation_db),
    )
    listed = registry.execute(
        "learning_library",
        {"action": "list", "library": "failure_case", "query": "导出"},
        ToolContext(user_id="user-1", db=generation_db),
    )

    assert experience.status == "success"
    assert template.status == "success"
    assert failure.status == "success"
    assert listed.payload["items"][0]["prevention_rule"] == "导出结果不得写入历史任务标题。"
    assert generation_db.query(ExperienceLibrary).count() == 1
    assert generation_db.query(TemplateLibrary).count() == 1
    assert generation_db.query(FailureCaseLibrary).count() == 1
    assert [log.tool_name for log in generation_db.query(AgentToolCallLog).order_by(AgentToolCallLog.id)] == [
        "learning_library",
        "learning_library",
        "learning_library",
        "learning_library",
    ]


def test_loop_runner_related_templates_use_personal_and_official_company_only(
    generation_db,
) -> None:
    from app.agent_loop.loop_runner import LoopRunner
    from app.models import TemplateLibrary

    generation_db.add_all(
        [
            TemplateLibrary(
                user_id="user-1",
                template_name="个人投标模板",
                task_type="bid_material",
                template_content="个人模板内容：先列评分点。",
                scope="personal",
                review_status="draft",
                status="active",
            ),
            TemplateLibrary(
                user_id="admin-1",
                template_name="公司投标模板",
                task_type="bid_material",
                template_content="公司模板内容：响应表必须包含偏离说明。",
                scope="company",
                review_status="official",
                status="active",
            ),
            TemplateLibrary(
                user_id="admin-1",
                template_name="待审投标模板",
                task_type="bid_material",
                template_content="待审模板内容。",
                scope="company",
                review_status="pending",
                status="active",
            ),
        ]
    )
    generation_db.commit()

    templates = LoopRunner()._related_templates(
        generation_db,
        sso_user_id="user-1",
        question="帮我写投标响应",
        task_type="bid_material",
    )

    joined = "\n".join(templates)
    assert "个人投标模板" in joined
    assert "公司投标模板" in joined
    assert "待审投标模板" not in joined
    assert templates[0].startswith("personal｜")


def test_history_task_tool_lists_and_reads_owned_conversations(
    generation_db,
) -> None:
    from datetime import UTC, datetime

    from app.agent_runtime.tools import HistoryTaskTool
    from app.crypto import ContentCipher
    from app.models import AgentToolCallLog, ChatMessage, ChatSession

    cipher = ContentCipher("a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s=")
    session = ChatSession(
        uuid="conv-owned",
        sso_user_id="user-1",
        title="安全运维方案",
        mode="normal",
        status="active",
        updated_at=datetime(2026, 7, 4, tzinfo=UTC).replace(tzinfo=None),
    )
    other_session = ChatSession(uuid="conv-other", sso_user_id="user-2", title="别人的任务")
    generation_db.add_all([session, other_session])
    generation_db.flush()
    message_uuid = "msg-owned"
    encrypted = cipher.encrypt_json({"content": "帮我写安全运维方案"}, message_uuid.encode())
    generation_db.add(ChatMessage(
        uuid=message_uuid,
        session_id=session.id,
        sso_user_id="user-1",
        role="user",
        content_ciphertext=encrypted.ciphertext,
        content_nonce=encrypted.nonce,
        key_version="v1",
        status="SUCCEEDED",
    ))
    generation_db.commit()

    registry = ToolRegistry()
    registry.register(HistoryTaskTool())
    context = ToolContext(
        user_id="user-1",
        db=generation_db,
        resources={"cipher": cipher},
    )

    listed = registry.execute("history_task", {"action": "list"}, context)
    detail = registry.execute("history_task", {"action": "detail", "conversation_id": "conv-owned"}, context)
    denied = registry.execute("history_task", {"action": "detail", "conversation_id": "conv-other"}, context)

    assert [item["session_uuid"] for item in listed.payload["items"]] == ["conv-owned"]
    assert detail.payload["session"]["title"] == "安全运维方案"
    assert detail.payload["messages"][0]["content"] == "帮我写安全运维方案"
    assert denied.status == "not_found"
    assert denied.error_code == "HISTORY_TASK_NOT_FOUND"
    assert generation_db.query(AgentToolCallLog).count() == 3
