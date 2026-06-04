from __future__ import annotations

import html
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Component, Project, ScanTask, VulnerabilityRecord


CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
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

WORD_STYLES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="宋体" w:hAnsi="Calibri"/><w:sz w:val="21"/><w:color w:val="1F2937"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:rFonts w:eastAsia="黑体"/><w:b/><w:sz w:val="42"/><w:color w:val="111827"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:rFonts w:eastAsia="宋体"/><w:sz w:val="24"/><w:color w:val="374151"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="180"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:eastAsia="黑体"/><w:b/><w:sz w:val="30"/><w:color w:val="0F172A"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:rFonts w:eastAsia="黑体"/><w:b/><w:sz w:val="24"/><w:color w:val="1F2937"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TOC"><w:name w:val="toc"/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:sz w:val="21"/></w:rPr></w:style>
</w:styles>"""

SEVERITY_LABELS = {
    "critical": "严重风险",
    "high": "高危风险",
    "medium": "中危风险",
    "low": "低危风险",
    "unknown": "未知风险",
}


def _project_data(db: Session, project_id: int) -> tuple[Project, list[Component], list[VulnerabilityRecord]]:
    project = db.get(Project, project_id)
    if not project:
        raise ValueError("项目不存在")
    components = list(db.scalars(select(Component).where(Component.project_id == project_id).order_by(Component.ecosystem, Component.package_name)))
    vulnerabilities = list(db.scalars(select(VulnerabilityRecord).where(VulnerabilityRecord.project_id == project_id)))
    return project, components, vulnerabilities


def _risk_counts(vulnerabilities: list[VulnerabilityRecord]) -> dict[str, int]:
    counts = {"critical": 0, "high": 0, "medium": 0, "low": 0, "unknown": 0}
    for vulnerability in _confirmed_vulnerabilities(vulnerabilities):
        counts[vulnerability.severity if vulnerability.severity in counts else "unknown"] += 1
    return counts


def _confirmed_vulnerabilities(vulnerabilities: list[VulnerabilityRecord]) -> list[VulnerabilityRecord]:
    return [item for item in vulnerabilities if item.match_status == "affected" and not item.needs_human_review]


def _priority_rank(value: str) -> int:
    return {"P0": 0, "P1": 1, "P2": 2, "P3": 3, "Review": 4, "Ignore": 5}.get(value or "Review", 4)


def _priority_sorted(vulnerabilities: list[VulnerabilityRecord]) -> list[VulnerabilityRecord]:
    return sorted(vulnerabilities, key=lambda item: (_priority_rank(item.risk_priority), -float(item.risk_score or 0), -float(item.cvss_score or 0)))


def _confidence_groups(vulnerabilities: list[VulnerabilityRecord]) -> dict[str, int]:
    groups = {"confirmed": 0, "review": 0, "false_positive": 0}
    for item in vulnerabilities:
        if item.risk_priority == "Ignore" or item.false_positive_possibility == "high":
            groups["false_positive"] += 1
        elif item.needs_human_review or item.match_status == "unknown" or item.risk_priority == "Review":
            groups["review"] += 1
        else:
            groups["confirmed"] += 1
    return groups


def _component_confidence_groups(components: list[Component]) -> dict[str, int]:
    return {
        "high": sum(1 for item in components if item.confidence_level == "High"),
        "medium": sum(1 for item in components if item.confidence_level in {"Medium", "Medium-High"}),
        "low": sum(1 for item in components if item.confidence_level == "Low"),
        "review": sum(1 for item in components if item.confidence_level == "Review"),
        "unknown_version": sum(1 for item in components if item.package_version == "unknown" or not item.version_detected),
        "manual_confirm": sum(1 for item in components if item.need_manual_confirm or item.need_manual_version_confirm),
    }


def _scan_task_summary(db: Session, project_id: int) -> dict[str, int]:
    tasks = list(db.scalars(select(ScanTask).where(ScanTask.project_id == project_id)))
    return {
        "opensca": sum(1 for item in tasks if item.engine_name == "opensca" and item.status in {"completed", "success"}),
        "syft": sum(1 for item in tasks if item.engine_name == "syft" and item.status in {"completed", "success"}),
        "trivy": sum(1 for item in tasks if item.engine_name == "trivy" and item.status in {"completed", "success"}),
        "dependency_track": sum(1 for item in tasks if item.engine_name == "dependency-track" and item.status in {"completed", "success"}),
        "failed": sum(1 for item in tasks if item.status in {"failed", "timeout"}),
        "skipped": sum(1 for item in tasks if item.status == "skipped"),
        "partial": sum(1 for item in tasks if item.status == "partial_completed"),
    }


def _release_advice(vulnerabilities: list[VulnerabilityRecord]) -> str:
    priorities = {item.risk_priority for item in vulnerabilities}
    if "P0" in priorities:
        return "不建议上线：存在 P0 级风险，需立即整改并复测。"
    if "P1" in priorities:
        return "建议整改后上线：存在 P1 级风险，应完成升级或缓解措施后再发布。"
    if priorities & {"Review"}:
        return "谨慎上线：存在待确认漏洞，建议完成证据复核后再进入生产发布。"
    return "可按流程上线：未发现需要阻断发布的已确认高优先级漏洞。"


def _natural_summary(project: Project, components: list[Component], vulnerabilities: list[VulnerabilityRecord]) -> str:
    confirmed = _confirmed_vulnerabilities(vulnerabilities)
    priority_counts = {level: sum(1 for item in confirmed if item.risk_priority == level) for level in ("P0", "P1", "P2", "P3")}
    risky_components = ", ".join(dict.fromkeys(item.package_name for item in _priority_sorted(confirmed)[:5])) or "暂无集中风险组件"
    urgent = priority_counts["P0"] + priority_counts["P1"]
    if urgent:
        risk_text = f"本次扫描发现 {urgent} 个需要优先整改的 P0/P1 风险"
    else:
        risk_text = "本次扫描未发现需要立即阻断的 P0/P1 已确认风险"
    return f"{risk_text}，风险主要集中在 {risky_components}。{_release_advice(confirmed)} 项目备注：{project.scan_note or '无'}。组件总数 {len(components)}，漏洞记录 {len(vulnerabilities)}。"


def _fix_command(component: Component | None, vulnerability: VulnerabilityRecord) -> str:
    name = vulnerability.package_name
    fixed = vulnerability.fixed_version or "安全版本"
    ecosystem = (vulnerability.ecosystem or getattr(component, "ecosystem", "") or "").lower()
    if ecosystem in {"maven", "java"}:
        return f"Maven：将 {name} 的版本升级到 {fixed}，并执行 mvn dependency:tree 验证传递依赖。"
    if ecosystem in {"npm", "node", "javascript"}:
        return f"npm：优先修改 package.json/lockfile 到 {name}@{fixed}，再执行 npm install 与 npm audit 验证。"
    if ecosystem in {"pypi", "python"}:
        return f"pip：执行 pip install {name}=={fixed}，并同步 requirements.txt/poetry.lock。"
    if ecosystem in {"go", "golang"}:
        return f"Go：执行 go get {name}@{fixed}，再运行 go mod tidy。"
    if ecosystem in {"docker", "container"}:
        return f"Docker：将基础镜像或镜像组件 {name} 升级到 {fixed}，重新构建并扫描镜像。"
    return f"通用：将 {name} 升级到 {fixed}，升级后重新扫描确认漏洞消除。"


def _report_lines(project: Project, components: list[Component], vulnerabilities: list[VulnerabilityRecord], scan_tasks: dict[str, int] | None = None) -> list[str]:
    counts = _risk_counts(vulnerabilities)
    confirmed = _confirmed_vulnerabilities(vulnerabilities)
    high_risk = [item for item in confirmed if item.severity in {"critical", "high"}]
    confidence = _confidence_groups(vulnerabilities)
    component_confidence = _component_confidence_groups(components)
    scan_tasks = scan_tasks or {}
    component_by_id = {item.id: item for item in components}
    priority_items = _priority_sorted(confirmed)
    fallback_enabled = any(item.detected_by == "fallback" for item in components)
    modes = sorted({item.scan_mode for item in components if item.scan_mode})
    unlocked_components = [item for item in components if item.version_risk_type]
    priority_lines = [
        f"{item.risk_priority or 'Review'}：{item.cve_id or item.advisory_id} / {item.package_name} {item.package_version}，建议期限 {item.suggested_deadline}"
        for item in priority_items[:12]
    ]
    fix_lines = [_fix_command(component_by_id.get(item.component_id or 0), item) for item in priority_items[:12]]
    unlocked_lines = [
        f"{item.ecosystem} / {item.source_file or item.source_path} / {item.package_name} / 声明版本 {item.declared_version or '未声明'} / 实际版本 {item.resolved_version or item.package_version} / {item.version_risk_type or item.version_lock_status} / {item.risk_explanation}"
        for item in unlocked_components[:20]
    ]
    lines = [
        "聚信软件成分安全分析报告",
        "企业 Logo：JUXIN",
        "一、本次扫描结论摘要",
        _natural_summary(project, components, vulnerabilities),
        f"上线建议：{_release_advice(confirmed)}",
        "是否需要立即整改：" + ("是，存在 P0/P1 风险。" if any(item.risk_priority in {"P0", "P1"} for item in confirmed) else "否，建议按常规整改计划推进。"),
        f"项目概况：{project.name}",
        f"扫描时间：{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}",
        f"扫描备注：{project.scan_note}",
        f"组件统计：共 {len(components)} 个组件",
        f"漏洞统计：共 {len(vulnerabilities)} 个漏洞，严重 {counts['critical']}，高危 {counts['high']}，中危 {counts['medium']}，低危 {counts['low']}",
        "二、漏洞可信度说明",
        f"已确认漏洞：{confidence['confirmed']}；待确认漏洞：{confidence['review']}；疑似误报漏洞：{confidence['false_positive']}。报告统计默认以已确认漏洞为主，待确认和疑似误报单独列示，避免误报影响管理层判断。",
        "三、整改优先级清单",
        "；".join(priority_lines) if priority_lines else "暂无需要整改的已确认漏洞。",
        "四、开发修复建议",
        "；".join(fix_lines) if fix_lines else "暂无开发侧升级命令建议。",
        "五、多工具扫描结果汇总",
        "本平台采用多工具联合分析机制，综合 OpenSCA、Syft、Trivy 与 OWASP Dependency-Track 的结果，对开源组件、SBOM、漏洞、License 和风险指标进行标准化、去重、合并和可信度评分。最终结果不是单一扫描器输出，而是经过多源交叉验证后的统一风险视图。",
        f"OpenSCA 成功任务数：{scan_tasks.get('opensca', 0)}；Syft 成功任务数：{scan_tasks.get('syft', 0)}；Trivy 成功任务数：{scan_tasks.get('trivy', 0)}；Dependency-Track 成功任务数：{scan_tasks.get('dependency_track', 0)}；失败/超时任务数：{scan_tasks.get('failed', 0)}；跳过任务数：{scan_tasks.get('skipped', 0)}。",
        f"高可信组件：{component_confidence['high']}；中可信组件：{component_confidence['medium']}；低可信组件：{component_confidence['low']}；待确认组件：{component_confidence['review']}。",
        "六、扫描完整性与识别可信度说明",
        f"是否启用兜底识别：{'是' if fallback_enabled else '否'}；扫描模式：{', '.join(modes) or 'unknown'}；版本未知组件：{component_confidence['unknown_version']}；待人工确认组件：{component_confidence['manual_confirm']}。",
        "本次扫描未发现完整依赖清单文件时，平台会启用兜底识别模式。由于缺少标准依赖声明或锁定文件，部分组件版本可能无法精确确认，相关漏洞结果已按可信度进行区分，低可信和版本未知结果不直接纳入高危漏洞结论。",
        "依赖版本未锁定风险：" + ("；".join(unlocked_lines) if unlocked_lines else "暂无未锁定版本、版本范围或版本缺失风险。"),
        "漏洞统计图：critical/high/medium/low = "
        + "/".join(str(counts[key]) for key in ("critical", "high", "medium", "low")),
        "高危漏洞：" + ("；".join(f"{item.cve_id or item.advisory_id} {item.package_name} {item.cvss_score}" for item in high_risk[:10]) or "暂无"),
        "修复建议：优先升级存在严重、高危漏洞的组件；无法升级时采用隔离、最小权限和访问控制降低暴露面。",
        "风险趋势：按漏洞发布时间持续跟踪新增漏洞，建议每次源码变更或镜像发布前重新扫描。",
        "等保整改建议：建立组件台账、漏洞处置闭环、补丁验证记录和供应链安全审计证据。",
    ]
    return lines


def _xml_text(value: object) -> str:
    text = "" if value is None else str(value)
    return html.escape(text.replace("\n", " / "))


def _run(text: object, *, bold: bool = False, size: int | None = None, color: str | None = None) -> str:
    props = []
    if bold:
        props.append("<w:b/>")
    if size:
        props.append(f'<w:sz w:val="{size}"/>')
    if color:
        props.append(f'<w:color w:val="{color}"/>')
    properties = f"<w:rPr>{''.join(props)}</w:rPr>" if props else ""
    space = ' xml:space="preserve"' if str(text).strip() != str(text) else ""
    return f"<w:r>{properties}<w:t{space}>{_xml_text(text)}</w:t></w:r>"


def _paragraph(
    text: object = "",
    *,
    style: str | None = None,
    align: str | None = None,
    bold: bool = False,
    size: int | None = None,
    color: str | None = None,
    page_break: bool = False,
) -> str:
    p_props = []
    if style:
        p_props.append(f'<w:pStyle w:val="{style}"/>')
    if align:
        p_props.append(f'<w:jc w:val="{align}"/>')
    properties = f"<w:pPr>{''.join(p_props)}</w:pPr>" if p_props else ""
    content = _run(text, bold=bold, size=size, color=color) if text != "" else ""
    if page_break:
        content += '<w:r><w:br w:type="page"/></w:r>'
    return f"<w:p>{properties}{content}</w:p>"


def _page_break() -> str:
    return _paragraph(page_break=True)


def _table_cell(value: object, *, header: bool = False, cols: int = 1) -> str:
    span = f'<w:gridSpan w:val="{cols}"/>' if cols > 1 else ""
    fill = '<w:shd w:fill="E5E7EB"/>' if header else ""
    props = f"<w:tcPr>{span}{fill}<w:tcMar><w:top w:w=\"80\" w:type=\"dxa\"/><w:left w:w=\"80\" w:type=\"dxa\"/><w:bottom w:w=\"80\" w:type=\"dxa\"/><w:right w:w=\"80\" w:type=\"dxa\"/></w:tcMar></w:tcPr>"
    return f"<w:tc>{props}{_paragraph(value, bold=header)}</w:tc>"


def _table(rows: list[list[object]], *, header_rows: int = 1) -> str:
    body = []
    for index, row in enumerate(rows):
        cells = "".join(_table_cell(value, header=index < header_rows) for value in row)
        body.append(f"<w:tr>{cells}</w:tr>")
    borders = (
        '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '<w:left w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '<w:bottom w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '<w:right w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '<w:insideH w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '<w:insideV w:val="single" w:sz="4" w:color="CBD5E1"/></w:tblBorders>'
    )
    props = f'<w:tblPr><w:tblW w:w="5000" w:type="pct"/>{borders}</w:tblPr>'
    return f"<w:tbl>{props}{''.join(body)}</w:tbl>"


def _severity_label(value: str | None) -> str:
    return SEVERITY_LABELS.get(value or "unknown", value or "未知风险")


def _report_date() -> str:
    return datetime.now(timezone.utc).strftime("%Y年%m月%d日")


def _component_type_summary(components: list[Component]) -> str:
    ecosystems = sorted({item.ecosystem for item in components if item.ecosystem})
    return "、".join(ecosystems) if ecosystems else "开源组件"


def _source_files(project: Project, components: list[Component]) -> list[list[object]]:
    files = []
    seen = set()
    for component in components:
        source = component.source_file or component.source_path
        if source and source not in seen:
            seen.add(source)
            files.append([len(files) + 1, project.name, source])
    return files or [[1, project.name, project.scan_note or "系统源代码"]]


def _component_rows(components: list[Component], limit: int = 120) -> list[list[object]]:
    rows = [["序号", "组件名称", "当前版本", "组件类型", "许可协议", "识别可信度"]]
    rows.extend(
        [
            [
                index,
                component.package_name,
                component.package_version or "unknown",
                component.ecosystem or "unknown",
                component.license_name or "未知",
                component.confidence_level or "High",
            ]
            for index, component in enumerate(components[:limit], start=1)
        ]
    )
    return rows


def _risk_rows(vulnerabilities: list[VulnerabilityRecord]) -> list[list[object]]:
    rows = [["风险等级", "漏洞数量"]]
    counts = _risk_counts(vulnerabilities)
    rows.extend(
        [
            ["严重风险", counts["critical"]],
            ["高危风险", counts["high"]],
            ["中危风险", counts["medium"]],
            ["低危风险", counts["low"]],
            ["未知风险", counts["unknown"]],
        ]
    )
    return rows


def _vulnerability_rows(vulnerabilities: list[VulnerabilityRecord], limit: int = 80) -> list[list[object]]:
    rows = [["序号", "组件名称", "组件版本", "风险等级", "CVE/公告", "修复版本", "备注"]]
    for index, vulnerability in enumerate(_priority_sorted(_confirmed_vulnerabilities(vulnerabilities))[:limit], start=1):
        rows.append(
            [
                index,
                vulnerability.package_name,
                vulnerability.package_version,
                _severity_label(vulnerability.severity),
                vulnerability.cve_id or vulnerability.advisory_id,
                vulnerability.fixed_version or "待确认",
                vulnerability.priority_reason or vulnerability.description or "已确认风险",
            ]
        )
    if len(rows) == 1:
        rows.append(["-", "暂无", "-", "暂无", "-", "-", "未发现已确认漏洞"])
    return rows


def _write_docx(
    path: Path,
    project: Project,
    components: list[Component],
    vulnerabilities: list[VulnerabilityRecord],
    scan_tasks: dict[str, int],
) -> None:
    confirmed = _confirmed_vulnerabilities(vulnerabilities)
    confidence = _confidence_groups(vulnerabilities)
    component_confidence = _component_confidence_groups(components)
    priority_items = _priority_sorted(confirmed)
    component_by_id = {item.id: item for item in components}
    date_text = _report_date()
    toc_items = [
        "1\t项目概述\t1",
        "1.1\t审核目的\t1",
        "1.2\t审核依据\t1",
        "1.3\t审计范围\t1",
        "1.4\t审计方法\t2",
        "2\t测试目标\t3",
        "3\t测试标准\t3",
        "4\t系统基本情况\t4",
        "4.1\t系统基本情况\t4",
        "4.2\t审查组件清单\t4",
        "5\t人员安排\t5",
        "6\t组件提交活跃度统计\t5",
        "7\t风险组件最新版本\t6",
        "8\t版权许可协议风险提示\t7",
        "9\t组件安全审计结果汇总\t8",
        "10\t审计结论及建议\t9",
        "附录A\t组件安全审计缺陷详情\t10",
        "附录B\t组件安全审计清单\t12",
        "附录C\t安全编码规范要求\t13",
    ]
    paragraphs = [
        _paragraph("XXXX有限公司", align="center", size=24),
        _paragraph(project.name, align="center", size=28, bold=True),
        _paragraph("软件成分分析报告", style="Title"),
        _paragraph(date_text, align="center", size=22),
        _paragraph("XXXXXX有限公司", align="center", size=22),
        _paragraph("版权所有  侵权必究", align="center", size=18),
        _page_break(),
        _paragraph("声 明", style="Heading1", align="center"),
        _paragraph("本报告无审核人员和授权签字人签字无效；"),
        _paragraph("本报告涂改无效；"),
        _paragraph("未经委托单位书面批准，不得复制报告（完整复制除外）；"),
        _paragraph("本报告审计结果仅对委托单位当时提供的源代码、依赖清单、构建产物和开源组件信息有效。当被测代码发生变更后，报告结论需重新验证。"),
        _paragraph("本报告结论的有效性建立在委托单位提供材料真实性和扫描环境完整性的基础上。"),
        _paragraph("报告属性信息", style="Heading1", align="center"),
        _paragraph("(Report Properties Information)", style="Subtitle"),
        _table(
            [
                ["项目名称 / Project Name", f"{project.name}SCA审计"],
                ["系统名称 / Software Name", project.name, "版本号 / Version Number", project.scan_note or "V1.0"],
                ["委托单位名称 / Client Name", "XXXX公司"],
                ["审计机构名称 / Organization Name", "XXXXXX有限公司"],
                ["样品内容及数量 / Audit Sample", f"系统源代码、系统开源组件 [{len(components)}]"],
                ["代码接收日期 / Accepted Date", date_text, "审计日期 / Testing Date", date_text],
                ["审计标准 / Audit Standard", "以《GB/T 39412-2020 信息安全技术 代码安全审查规范》及开源组件漏洞库为主要依据。"],
            ],
            header_rows=0,
        ),
        _page_break(),
        _paragraph("目  录", style="Title"),
        *[_paragraph(item, style="TOC") for item in toc_items],
        _page_break(),
        _paragraph("1 项目概述", style="Heading1"),
        _paragraph("组件安全审计工作通过分析当前业务系统的源代码、依赖声明、构建文件和扫描结果，识别系统引入的开源组件、许可证与已公开漏洞，并给出风险等级、整改优先级和修复建议。"),
        _paragraph("1.1 审核目的", style="Heading2"),
        _paragraph("本次审计用于检查业务系统开源组件使用情况，发现存在安全漏洞、许可证风险、版本缺失或版本未锁定的组件，支撑后续整改和复测。"),
        _paragraph("1.2 审核依据", style="Heading2"),
        _paragraph("本次审计以 GB/T 39412-2020、CWE TOP25、NVD/CVE、OSV、GitHub Advisory 以及多工具扫描结果为参考依据。"),
        _paragraph("1.3 审计范围", style="Heading2"),
        _paragraph(f"本次审计范围为项目“{project.name}”提交的源代码、依赖文件、SBOM 信息和平台扫描结果。项目备注：{project.scan_note or '无'}。"),
        _paragraph("1.4 审计方法", style="Heading2"),
        _paragraph("审计采用工具审查、规则匹配、多源漏洞合并、可信度评分和人工复核标记相结合的方式，最终形成统一的组件安全风险视图。"),
        _table(
            [
                ["检测类型", "检测项", "描述"],
                ["漏洞检测", "CVE/OSV/GHSA", "识别开源组件公开漏洞与受影响版本范围"],
                ["许可证检测", "License", "识别组件许可证并提示潜在合规风险"],
                ["版本风险", "版本锁定/版本未知", "识别未锁定版本、版本范围和不可确认版本"],
                ["可信度分析", "多工具交叉验证", "区分已确认、待确认和疑似误报结果"],
            ]
        ),
        _paragraph("2 测试目标", style="Heading1"),
        _paragraph("确认系统开源组件清单、漏洞数量、风险等级、影响范围、修复版本和整改优先级，为上线评审、等保整改和供应链安全治理提供依据。"),
        _paragraph("3 测试标准", style="Heading1"),
        _paragraph("测试结果按照严重、高危、中危、低危和未知风险分级，并结合 P0/P1/P2/P3/Review 优先级、CVSS 评分、可信度和修复版本可用性确定整改顺序。"),
        _paragraph("4 系统基本情况", style="Heading1"),
        _paragraph("4.1 系统基本情况", style="Heading2"),
        _table([["编号", "基本项", "描述"], ["1", "组件数量", len(components)], ["2", "组件类型", _component_type_summary(components)], ["3", "漏洞记录", len(vulnerabilities)], ["4", "上线建议", _release_advice(confirmed)]]),
        _paragraph("4.2 审查组件清单", style="Heading2"),
        _table([["序号", "检测目标", "组件依赖文件包"], *_source_files(project, components)]),
        _paragraph("5 人员安排", style="Heading1"),
        _table([["编号", "参与人员", "负责内容"], ["1", "平台自动扫描", "组件识别、SBOM 生成、漏洞匹配"], ["2", "安全分析人员", "风险确认、报告审查、整改建议"]]),
        _paragraph("6 组件提交活跃度统计", style="Heading1"),
        _table([["序号", "组件名称", "当前版本", "发布日期", "活跃度", "活跃度参考说明"], *[[index, item.package_name, item.package_version, "未知", "待确认", "建议结合组件仓库活跃度复核"] for index, item in enumerate(components[:20], start=1)]]),
        _paragraph("7 风险组件最新版本", style="Heading1"),
        _table([["序号", "组件名称", "当前版本", "建议升级版本", "是否需要升级"], *[[index, item.package_name, item.package_version, item.fixed_version or "安全版本", "是"] for index, item in enumerate(priority_items[:20], start=1)]] or [["序号", "组件名称", "当前版本", "建议升级版本", "是否需要升级"], ["-", "暂无", "-", "-", "否"]]),
        _paragraph("8 版权许可协议风险提示", style="Heading1"),
        _paragraph("许可证风险需结合组件使用方式、分发方式、修改情况和企业合规要求进行复核。下表列出本次识别到的组件许可证信息。"),
        _table([["序号", "组件名称", "当前版本", "许可协议"], *[[index, item.package_name, item.package_version, item.license_name or "未知"] for index, item in enumerate(components[:80], start=1)]]),
        _paragraph("9 组件安全审计结果汇总", style="Heading1"),
        _paragraph("本次扫描结论摘要", style="Heading2"),
        _paragraph(_natural_summary(project, components, vulnerabilities)),
        _table(_risk_rows(vulnerabilities)),
        _paragraph("漏洞可信度说明", style="Heading2"),
        _paragraph(f"已确认漏洞：{confidence['confirmed']}；待确认漏洞：{confidence['review']}；疑似误报漏洞：{confidence['false_positive']}。报告统计默认以已确认漏洞为主，待确认和疑似误报单独列示。"),
        _paragraph("多工具扫描结果汇总", style="Heading2"),
        _table(
            [
                ["扫描引擎", "成功任务数"],
                ["OpenSCA", scan_tasks.get("opensca", 0)],
                ["Syft", scan_tasks.get("syft", 0)],
                ["Trivy", scan_tasks.get("trivy", 0)],
                ["Dependency-Track", scan_tasks.get("dependency_track", 0)],
                ["失败/超时", scan_tasks.get("failed", 0)],
            ]
        ),
        _paragraph("组件安全测试", style="Heading2"),
        _table(_vulnerability_rows(vulnerabilities)),
        _paragraph("10 审计结论及建议", style="Heading1"),
        _paragraph(f"上线建议：{_release_advice(confirmed)}"),
        _paragraph("整改优先级清单", style="Heading2"),
        _table([["优先级", "CVE/公告", "组件", "当前版本", "等级", "风险分", "修复版本", "建议期限"], *[[item.risk_priority or "Review", item.cve_id or item.advisory_id, item.package_name, item.package_version, _severity_label(item.severity), item.risk_score, item.fixed_version or "安全版本", item.suggested_deadline or "按计划修复"] for item in priority_items[:20]]] or [["优先级", "CVE/公告", "组件", "当前版本", "等级", "风险分", "修复版本", "建议期限"], ["-", "暂无", "-", "-", "-", "-", "-", "-"]]),
        _paragraph("开发修复建议", style="Heading2"),
        *[_paragraph(_fix_command(component_by_id.get(item.component_id or 0), item)) for item in priority_items[:12]],
        _paragraph("附录A 组件安全审计缺陷详情", style="Heading1"),
    ]
    if priority_items:
        for item in priority_items[:20]:
            paragraphs.extend(
                [
                    _table([["组件名称", item.package_name], ["当前版本", item.package_version], ["风险等级", _severity_label(item.severity)], ["检出时间", item.published_at_text or date_text]], header_rows=0),
                    _table(
                        [
                            ["漏洞名称", item.advisory_id or item.cve_id or "组件漏洞"],
                            ["风险等级", _severity_label(item.severity)],
                            ["CVE编号", item.cve_id or item.advisory_id or "待确认"],
                            ["受影响组件", f"{item.package_name} {item.package_version}"],
                            ["发布时间", item.published_at_text or "未知"],
                            ["漏洞描述", item.description or item.priority_reason or "暂无描述"],
                            ["修复建议", _fix_command(component_by_id.get(item.component_id or 0), item)],
                        ],
                        header_rows=0,
                    ),
                ]
            )
    else:
        paragraphs.append(_paragraph("本次审计未发现已确认组件安全缺陷。"))
    paragraphs.extend(
        [
            _paragraph("附录B 组件安全审计清单", style="Heading1"),
            _paragraph(f"高可信组件：{component_confidence['high']}；中可信组件：{component_confidence['medium']}；低可信组件：{component_confidence['low']}；待确认组件：{component_confidence['review']}。"),
            _table(_component_rows(components)),
            _paragraph("附录C 安全编码规范要求", style="Heading1"),
            _table(
                [
                    ["类别", "规范要求"],
                    ["输入验证", "对外部输入进行白名单校验，避免注入和越权访问。"],
                    ["身份认证", "统一认证入口，密码和凭据不得硬编码在源码中。"],
                    ["访问控制", "按最小权限原则限制敏感接口、数据和后台任务。"],
                    ["日志审计", "记录关键安全事件，避免日志输出敏感信息。"],
                    ["组件治理", "建立组件台账、版本锁定、漏洞响应和复测闭环。"],
                ]
            ),
        ]
    )
    section = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
    document = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{''.join(paragraphs)}{section}</w:body></w:document>"""
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", CONTENT_TYPES)
        archive.writestr("_rels/.rels", WORD_RELS)
        archive.writestr("word/styles.xml", WORD_STYLES)
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
    scan_tasks = _scan_task_summary(db, project_id)
    output_dir = Path(report_root)
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    path = output_dir / f"juxin-sca-report-{project_id}-{timestamp}.{fmt}"
    lines = _report_lines(project, components, vulnerabilities, scan_tasks)
    if fmt == "docx":
        _write_docx(path, project, components, vulnerabilities, scan_tasks)
    elif fmt == "xlsx":
        confidence = _confidence_groups(vulnerabilities)
        rows = [
            ["本次扫描结论摘要", _natural_summary(project, components, vulnerabilities)],
            ["上线建议", _release_advice(_confirmed_vulnerabilities(vulnerabilities))],
            ["组件数", str(len(components))],
            ["漏洞数", str(len(vulnerabilities))],
            ["已确认漏洞", str(confidence["confirmed"])],
            ["待确认漏洞", str(confidence["review"])],
            ["疑似误报漏洞", str(confidence["false_positive"])],
            ["OpenSCA 成功任务数", str(scan_tasks["opensca"])],
            ["Syft 成功任务数", str(scan_tasks["syft"])],
            ["Trivy 成功任务数", str(scan_tasks["trivy"])],
            ["Dependency-Track 成功任务数", str(scan_tasks["dependency_track"])],
            ["版本未知组件", str(_component_confidence_groups(components)["unknown_version"])],
            ["待人工确认组件", str(_component_confidence_groups(components)["manual_confirm"])],
            ["整改建议", lines[-2]],
            [],
            ["依赖版本锁定风险"],
            ["生态", "依赖文件", "依赖名称", "声明版本", "实际版本", "版本锁定状态", "风险类型", "风险说明", "修复建议"],
        ]
        rows.extend(
            [
                [
                    item.ecosystem,
                    item.source_file or item.source_path,
                    item.package_name,
                    item.declared_version,
                    item.resolved_version or item.package_version,
                    item.version_lock_status,
                    item.version_risk_type,
                    item.risk_explanation,
                    item.fix_recommendation,
                ]
                for item in components
                if item.version_risk_type or item.need_manual_version_confirm
            ]
        )
        rows.extend(
            [
                [],
                ["整改优先级清单"],
                ["优先级", "CVE/公告", "组件", "当前版本", "等级", "风险分", "修复版本", "建议期限", "修复命令"],
            ]
        )
        component_by_id = {item.id: item for item in components}
        rows.extend(
            [
                [
                    item.risk_priority,
                    item.cve_id or item.advisory_id,
                    item.package_name,
                    item.package_version,
                    item.severity,
                    str(item.risk_score),
                    item.fixed_version,
                    item.suggested_deadline,
                    _fix_command(component_by_id.get(item.component_id or 0), item),
                ]
                for item in _priority_sorted(_confirmed_vulnerabilities(vulnerabilities))
            ]
        )
        _write_xlsx(path, rows)
    elif fmt == "pdf":
        _write_pdf(path, lines)
    else:
        raise ValueError("不支持的报告格式")
    return path
