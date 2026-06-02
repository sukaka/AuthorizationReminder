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
    scan_tasks = _scan_task_summary(db, project_id)
    output_dir = Path(report_root)
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    path = output_dir / f"juxin-sca-report-{project_id}-{timestamp}.{fmt}"
    lines = _report_lines(project, components, vulnerabilities, scan_tasks)
    if fmt == "docx":
        _write_docx(path, lines)
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
