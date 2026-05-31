from __future__ import annotations

import html
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Component, Project, VulnerabilityRecord


CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"""

WORD_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""

XLSX_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>"""

XLSX_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"""

WORKBOOK = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="安全分析报告" sheetId="1" r:id="rId1"/></sheets></workbook>"""

WORKBOOK_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>"""


def _project_data(db: Session, project_id: int) -> tuple[Project, list[Component], list[VulnerabilityRecord]]:
    project = db.get(Project, project_id)
    if not project:
        raise ValueError("项目不存在")
    components = list(db.scalars(select(Component).where(Component.project_id == project_id).order_by(Component.ecosystem, Component.package_name)))
    vulnerabilities = list(
        db.scalars(select(VulnerabilityRecord).where(VulnerabilityRecord.project_id == project_id).order_by(VulnerabilityRecord.cvss_score.desc()))
    )
    return project, components, vulnerabilities


def _risk_counts(vulnerabilities: list[VulnerabilityRecord]) -> dict[str, int]:
    counts = {"critical": 0, "high": 0, "medium": 0, "low": 0, "unknown": 0}
    for vulnerability in vulnerabilities:
        counts[vulnerability.severity if vulnerability.severity in counts else "unknown"] += 1
    return counts


def _report_lines(project: Project, components: list[Component], vulnerabilities: list[VulnerabilityRecord]) -> list[str]:
    counts = _risk_counts(vulnerabilities)
    high_risk = [item for item in vulnerabilities if item.severity in {"critical", "high"}]
    return [
        "聚信软件成分安全分析报告",
        "企业 Logo：JUXIN",
        f"项目概况：{project.name}",
        f"扫描时间：{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}",
        f"扫描备注：{project.scan_note}",
        f"组件统计：共 {len(components)} 个组件",
        f"漏洞统计：共 {len(vulnerabilities)} 个漏洞，严重 {counts['critical']}，高危 {counts['high']}，中危 {counts['medium']}，低危 {counts['low']}",
        "漏洞统计图：critical/high/medium/low = "
        + "/".join(str(counts[key]) for key in ("critical", "high", "medium", "low")),
        "高危漏洞：" + ("；".join(f"{item.cve_id or item.advisory_id} {item.package_name} {item.cvss_score}" for item in high_risk[:10]) or "暂无"),
        "修复建议：优先升级存在严重、高危漏洞的组件；无法升级时采用隔离、最小权限和访问控制降低暴露面。",
        "风险趋势：按漏洞发布时间持续跟踪新增漏洞，建议每次源码变更或镜像发布前重新扫描。",
        "等保整改建议：建立组件台账、漏洞处置闭环、补丁验证记录和供应链安全审计证据。",
    ]


def _write_docx(path: Path, lines: list[str]) -> None:
    paragraphs = "".join(f"<w:p><w:r><w:t>{html.escape(line)}</w:t></w:r></w:p>" for line in lines)
    document = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{paragraphs}</w:body></w:document>"""
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", CONTENT_TYPES)
        archive.writestr("_rels/.rels", WORD_RELS)
        archive.writestr("word/document.xml", document)


def _write_xlsx(path: Path, rows: list[list[str]]) -> None:
    row_xml = []
    for row_index, row in enumerate(rows, start=1):
        cells = []
        for column_index, value in enumerate(row):
            column = chr(ord("A") + column_index)
            cells.append(f'<c r="{column}{row_index}" t="inlineStr"><is><t>{html.escape(str(value))}</t></is></c>')
        row_xml.append(f'<row r="{row_index}">{"".join(cells)}</row>')
    sheet = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>{''.join(row_xml)}</sheetData></worksheet>"""
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", XLSX_TYPES)
        archive.writestr("_rels/.rels", XLSX_RELS)
        archive.writestr("xl/workbook.xml", WORKBOOK)
        archive.writestr("xl/_rels/workbook.xml.rels", WORKBOOK_RELS)
        archive.writestr("xl/worksheets/sheet1.xml", sheet)


def _write_pdf(path: Path, lines: list[str]) -> None:
    payload = json.dumps({"template": "聚信中文安全分析报告", "lines": lines}, ensure_ascii=False, indent=2)
    stream = f"BT /F1 12 Tf 50 760 Td ({payload[:900].replace('(', '[').replace(')', ']')}) Tj ET"
    body = f"""%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length {len(stream.encode("utf-8"))} >> stream
{stream}
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
trailer << /Root 1 0 R >>
%%EOF
"""
    path.write_bytes(body.encode("utf-8"))


def generate_report(db: Session, project_id: int, fmt: str, report_root: str) -> Path:
    project, components, vulnerabilities = _project_data(db, project_id)
    output_dir = Path(report_root)
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    path = output_dir / f"juxin-sca-report-{project_id}-{timestamp}.{fmt}"
    lines = _report_lines(project, components, vulnerabilities)
    if fmt == "docx":
        _write_docx(path, lines)
    elif fmt == "xlsx":
        rows = [["项目", project.name], ["组件数", str(len(components))], ["漏洞数", str(len(vulnerabilities))], ["整改建议", lines[-2]]]
        rows.extend([["CVE", "组件", "版本", "等级", "CVSS", "修复版本"]])
        rows.extend([[item.cve_id, item.package_name, item.package_version, item.severity, str(item.cvss_score), item.fixed_version] for item in vulnerabilities])
        _write_xlsx(path, rows)
    elif fmt == "pdf":
        _write_pdf(path, lines)
    else:
        raise ValueError("不支持的报告格式")
    return path
