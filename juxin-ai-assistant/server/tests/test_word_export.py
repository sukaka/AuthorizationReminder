from io import BytesIO

from docx import Document
from docx.oxml.ns import qn

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


def test_render_word_applies_company_output_control_footer_and_brand_line():
    payload = render_generation_docx(
        title="客户项目交付报告",
        task_name="项目交付",
        department="产品交付部",
        author="张三",
        output="# 基本信息\n\n正文",
        version="1.0.0",
    )

    document = Document(BytesIO(payload))
    section = document.sections[0]
    footer_xml = section.footer.paragraphs[0]._p.xml
    header_border = section.header.paragraphs[0]._p.get_or_add_pPr().find(qn("w:pBdr"))
    header_bottom = None if header_border is None else header_border.find(qn("w:bottom"))

    assert "北京聚信得仁科技有限公司" in section.footer.paragraphs[0].text
    assert "客户项目交付文档" in section.footer.paragraphs[0].text
    assert "共 " in section.footer.paragraphs[0].text
    assert "NUMPAGES" in footer_xml
    assert header_bottom is not None
    assert header_bottom.get(qn("w:color")) in {"C00000", "D9D9D9"}


def test_render_word_backfills_company_required_structure_and_final_checks():
    payload = render_generation_docx(
        title="客户项目交付报告",
        task_name="项目交付",
        department="产品交付部",
        author="张三",
        output="# 主要内容\n\n已生成正文",
        version="1.0.0",
    )

    document = Document(BytesIO(payload))
    text = "\n".join(paragraph.text for paragraph in document.paragraphs)

    for section in (
        "基本信息",
        "背景说明",
        "目标与范围",
        "主要内容",
        "执行步骤或工作安排",
        "表格清单或结果统计",
        "风险与注意事项",
        "需确认事项",
        "交付物或附件",
        "结论与下一步计划",
    ):
        assert section in text

    for item in (
        "待确认事项",
        "需人工复核事项",
        "不建议直接对外发送的内容",
        "可以直接落地执行的下一步动作",
    ):
        assert item in text

    for label in ("已知事实", "合理判断", "风险提醒"):
        assert label in text


def test_render_word_fills_blank_table_cells_with_pending_confirmation():
    payload = render_generation_docx(
        title="客户项目交付报告",
        task_name="项目交付",
        department="产品交付部",
        author="张三",
        output="| 字段 | 内容 |\n|---|---|\n| 客户名称 | |",
        version="1.0.0",
    )

    document = Document(BytesIO(payload))

    data_table = next(
        table
        for table in document.tables
        if any(cell.text == "客户名称" for row in table.rows for cell in row.cells)
    )

    assert data_table.cell(1, 1).text == "待确认"
