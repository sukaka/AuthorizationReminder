from __future__ import annotations

from types import SimpleNamespace


def test_verify_references_drops_source_mentioned_only_as_missing_evidence() -> None:
    from app.agent_loop.verifier import Verifier

    result = Verifier().verify_references(
        "《安全运维方案.pdf》中没有明确依据，无法确认该项要求。",
        [
            {
                "source_type": "session_attachment",
                "source_uuid": "file-1",
                "file_name": "安全运维方案.pdf",
                "title": "安全运维方案.pdf",
            }
        ],
    )

    assert result["kept_count"] == 0
    assert result["removed_count"] == 1
    assert result["sources"] == []
    assert result["suggestions"] == ["建议复核：已移除仅作为缺少依据提及的参考来源。"]


def test_verify_references_keeps_source_used_as_evidence() -> None:
    from app.agent_loop.verifier import Verifier

    result = Verifier().verify_references(
        "根据《安全运维方案.pdf》的服务范围章节，建议先完成资产梳理。",
        [
            {
                "source_type": "session_attachment",
                "source_uuid": "file-1",
                "file_name": "安全运维方案.pdf",
                "title": "安全运维方案.pdf",
            }
        ],
    )

    assert result["kept_count"] == 1
    assert result["removed_count"] == 0
    assert result["sources"][0]["file_name"] == "安全运维方案.pdf"
    assert result["suggestions"] == []


def test_verify_references_drops_formal_file_mention_without_chunk_evidence() -> None:
    from app.agent_loop.verifier import Verifier

    result = Verifier().verify_references(
        "我参考《安全运维方案.pdf》生成如下建议：请先组织项目启动会。",
        [
            {
                "source_type": "session_attachment",
                "source_uuid": "file-1",
                "file_name": "安全运维方案.pdf",
                "title": "安全运维方案.pdf",
                "chunk_text": "资产梳理、漏洞扫描、日志审计和应急响应按月形成报告。",
                "section_title": "服务范围",
            }
        ],
    )

    assert result["kept_count"] == 0
    assert result["removed_count"] == 1


def test_verify_references_handles_object_sources_and_non_int_scores() -> None:
    from app.agent_loop.verifier import Verifier

    result = Verifier().verify_references(
        "根据服务范围章节，资产梳理和漏洞扫描需要按月形成报告。",
        [
            SimpleNamespace(
                source_type="official_knowledge",
                source_uuid="file-1",
                file_name="安全运维方案.pdf",
                title="安全运维方案.pdf",
                chunk_id="chunk-1",
                page_number=3,
                section_title="服务范围",
                chunk_index=2,
                score="high",
                chunk_text="资产梳理、漏洞扫描、日志审计和应急响应按月形成报告。",
            )
        ],
    )

    assert result["kept_count"] == 1
    assert result["sources"][0]["score"] == 0


def test_verify_document_structure_warns_when_ops_plan_lacks_manual_review_section() -> None:
    from app.agent_loop.verifier import Verifier

    result = Verifier().verify_document_structure(
        "一、服务目标\n提供安全巡检、漏洞修复和应急响应服务。\n二、实施计划\n分阶段推进。",
        task_type="安全运维服务方案",
    )

    assert result["status"] == "warning"
    assert result["warnings"] == ["建议复核：安全运维/服务方案类文档建议补充“待确认事项/需人工复核事项”。"]
    assert result["risks"] == []


def test_verify_document_structure_does_not_warn_for_generic_service_plan() -> None:
    from app.agent_loop.verifier import Verifier

    result = Verifier().verify_document_structure(
        "一、服务目标\n整理员工培训安排。\n二、实施计划\n分阶段推进。",
        task_type="行政服务方案",
    )

    assert result["status"] == "pass"
    assert result["warnings"] == []
    assert result["risks"] == []


def test_verify_document_structure_flags_absolute_security_promises() -> None:
    from app.agent_loop.verifier import Verifier

    result = Verifier().verify_document_structure(
        "本方案可100%防住所有攻击，并保证必定通过测评，完全无风险。",
        task_type="安全运维服务方案",
    )

    assert result["status"] == "risk"
    assert result["warnings"]
    assert result["risks"] == [
        "风险提示：文档包含绝对化承诺，建议改为有条件、可复核的表述。"
    ]
