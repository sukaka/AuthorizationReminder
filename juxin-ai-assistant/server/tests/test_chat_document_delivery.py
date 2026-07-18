from app.chat_document_delivery import (
    chat_document_file_name,
    choose_chat_document_format,
    requested_chat_document_format,
    should_generate_chat_document,
)


def test_explicit_format_takes_priority() -> None:
    question = "请把这份方案导出成 Excel 表格"

    assert requested_chat_document_format(question) == "xlsx"
    assert choose_chat_document_format(question, "# 项目方案\n正文") == "xlsx"
    assert should_generate_chat_document(question)


def test_supports_all_explicit_formats() -> None:
    cases = {
        "请生成 Word 文档发给我": "docx",
        "请整理成 PPT 演示文稿下载": "pptx",
        "请导出成 Markdown 文件": "md",
    }

    for question, expected in cases.items():
        assert requested_chat_document_format(question) == expected
        assert should_generate_chat_document(question)


def test_chooses_format_from_content_when_unspecified() -> None:
    assert choose_chat_document_format("导出项目数据表", "项目清单") == "xlsx"
    assert choose_chat_document_format("整理汇报材料并发我", "答辩演示内容") == "pptx"
    assert choose_chat_document_format("写一份方案并导出", "项目方案") == "docx"


def test_does_not_generate_for_plain_chat_request() -> None:
    assert not should_generate_chat_document("帮我写一份项目方案")
    assert not should_generate_chat_document("这个方案怎么改")
    assert not should_generate_chat_document("这个文件里的第三章节是什么意思")


def test_generated_file_name_has_safe_extension() -> None:
    assert chat_document_file_name("导出方案", "# 项目/方案", "docx") == "项目 方案.docx"
