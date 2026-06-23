from io import BytesIO

from docx import Document

from app.word_export import render_generation_docx


def test_render_word_uses_v110_page_and_brand_rules():
    payload = render_generation_docx(
        title="项目实施报告",
        task_name="实施报告",
        department="产品交付部",
        author="张三",
        output="# 一、项目背景\n\n正文\n\n| 项目 | 内容 |\n|---|---|\n| 状态 | 已完成 |",
        version="V1.0",
    )

    document = Document(BytesIO(payload))
    section = document.sections[0]

    assert round(section.top_margin.cm, 1) == 2.5
    assert round(section.left_margin.cm, 1) == 2.8
    assert "聚信得仁" in section.header.paragraphs[0].text
    assert any(table.cell(0, 0).text == "项目" for table in document.tables)


def test_render_word_preserves_unrecognized_text():
    payload = render_generation_docx(
        title="异常语法报告",
        task_name="异常语法",
        department="产品交付部",
        author="张三",
        output="未闭合 **文本",
        version="V1.0",
    )

    document = Document(BytesIO(payload))
    text = "\n".join(paragraph.text for paragraph in document.paragraphs)

    assert "未闭合 **文本" in text
