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


def test_render_word_numbers_headings_by_level():
    payload = render_generation_docx(
        title="项目实施报告",
        task_name="实施报告",
        department="产品交付部",
        author="张三",
        output=(
            "# 项目背景\n\n"
            "## 建设范围\n\n"
            "### 系统边界\n\n"
            "## 交付内容\n\n"
            "# 实施计划\n\n"
            "### 注意事项\n\n"
            "# 三、已有编号"
        ),
        version="V1.0",
    )

    document = Document(BytesIO(payload))
    headings = [
        paragraph.text
        for paragraph in document.paragraphs
        if paragraph.style.name in {"Heading 1", "Heading 2", "Heading 3"}
    ]

    assert headings[:7] == [
        "一、修订记录",
        "二、项目背景",
        "1. 建设范围",
        "（1）系统边界",
        "2. 交付内容",
        "三、实施计划",
        "（1）注意事项",
    ]
    assert "四、已有编号" in headings
    assert "四、三、已有编号" not in headings


def test_render_word_renumbers_existing_heading_prefixes():
    payload = render_generation_docx(
        title="项目实施报告",
        task_name="实施报告",
        department="产品交付部",
        author="张三",
        output=(
            "# 一、项目背景\n\n"
            "# 实施计划\n\n"
            "## 2. 建设范围\n\n"
            "## 交付内容\n\n"
            "### （3）系统边界\n\n"
            "### 验收要求"
        ),
        version="V1.0",
    )

    document = Document(BytesIO(payload))
    headings = [
        paragraph.text
        for paragraph in document.paragraphs
        if paragraph.style.name in {"Heading 1", "Heading 2", "Heading 3"}
    ]

    assert headings[:7] == [
        "一、修订记录",
        "二、项目背景",
        "三、实施计划",
        "1. 建设范围",
        "2. 交付内容",
        "（1）系统边界",
        "（2）验收要求",
    ]
    assert "一、项目背景" not in headings
    assert "2. 2. 建设范围" not in headings


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
