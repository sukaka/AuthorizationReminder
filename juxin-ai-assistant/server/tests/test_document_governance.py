from app.document_governance import render_document_governance


def test_formal_report_gets_general_and_report_rules():
    rendered = render_document_governance(
        formal_document=True,
        document_type="REPORT",
    )
    assert "聚信得仁公司级统一输出总控要求" in rendered
    assert "工作概述、执行过程、结果统计" in rendered


def test_plain_text_task_gets_no_document_template():
    assert render_document_governance(
        formal_document=False,
        document_type="PLAIN_TEXT",
    ) == ""


def test_unknown_formal_document_type_uses_default_structure():
    rendered = render_document_governance(
        formal_document=True,
        document_type="UNKNOWN",
    )
    assert "聚信得仁公司级统一输出总控要求" in rendered
    assert "文档目的、适用范围、主要内容" in rendered
