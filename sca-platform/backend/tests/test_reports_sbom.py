import importlib
import zipfile
import xml.etree.ElementTree as ET
from io import BytesIO

from fastapi.testclient import TestClient


def build_client(monkeypatch, tmp_path):
    db_path = tmp_path / "sca-test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("AUTH_DEV_BYPASS", "true")
    monkeypatch.setenv("APP_VERSION", "0.1.0")
    monkeypatch.setenv("REPORT_ROOT", str(tmp_path / "reports"))
    monkeypatch.setenv("SBOM_ROOT", str(tmp_path / "sbom"))
    monkeypatch.setenv("TOOL_SYFT_PATH", str(tmp_path / "missing-syft"))
    monkeypatch.setenv("TOOL_TRIVY_PATH", str(tmp_path / "missing-trivy"))
    monkeypatch.setenv("TOOL_GRYPE_PATH", str(tmp_path / "missing-grype"))

    from app import config

    config.get_settings.cache_clear()
    import app.database as database
    import app.models as models
    import app.report_service as report_service
    import app.sbom_service as sbom_service
    import app.main as main

    importlib.reload(database)
    importlib.reload(models)
    importlib.reload(report_service)
    importlib.reload(sbom_service)
    importlib.reload(main)
    return TestClient(main.app), main, models, database


def seed_project(database, models):
    with database.SessionLocal() as db:
        project = models.Project(name="报告项目", scan_note="v1.0")
        db.add(project)
        db.flush()
        component = models.Component(
            project_id=project.id,
            package_name="fastapi",
            package_version="0.115.6",
            ecosystem="pypi",
            group_id="fastapi",
            dependency_type="direct",
            source_file="requirements.txt",
            license_name="MIT",
        )
        db.add(component)
        db.flush()
        db.add(
            models.VulnerabilityRecord(
                project_id=project.id,
                component_id=component.id,
                source="osv",
                advisory_id="CVE-2024-9999",
                cve_id="CVE-2024-9999",
                package_name="fastapi",
                package_version="0.115.6",
                ecosystem="pypi",
                cvss_score=8.8,
                severity="high",
                description="高危漏洞示例",
                fixed_version="0.115.7",
                published_at_text="2024-05-01T00:00:00Z",
                cwe_id="CWE-79",
                confidence_score=0.92,
                risk_priority="P1",
                risk_score=88,
                suggested_deadline="7 天内修复",
                priority_reason="高危且存在安全版本",
            )
        )
        db.commit()
        return project.id


def report_metadata():
    return {
        "client_name": "聚信测试委托单位",
        "client_address": "北京市海淀区测试路 1 号",
        "contact_name": "张三",
        "contact_phone": "13800000000",
        "contact_email": "security@example.com",
        "organization_name": "聚信安全审计中心",
        "audit_address": "北京实验室",
        "auditor_name": "审计专员01",
        "reviewer_name": "复核专员02",
        "quality_reviewer_name": "质量专员03",
        "accepted_date": "2026.06.01",
        "audit_start_date": "2026.06.01",
        "audit_end_date": "2026.06.04",
        "version_number": "V2.0",
    }


def workbook_values(content: bytes) -> dict[str, list[list[object]]]:
    ns = {
        "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
        "rel": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "pkgrel": "http://schemas.openxmlformats.org/package/2006/relationships",
    }
    with zipfile.ZipFile(BytesIO(content)) as archive:
        shared_strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            shared_root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            for item in shared_root.findall("main:si", ns):
                shared_strings.append("".join(text.text or "" for text in item.findall(".//main:t", ns)))
        workbook_root = ET.fromstring(archive.read("xl/workbook.xml"))
        rels_root = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        rels = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels_root.findall("pkgrel:Relationship", ns)}
        sheets = {}
        for sheet in workbook_root.findall("main:sheets/main:sheet", ns):
            name = sheet.attrib["name"]
            rel_id = sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
            target = rels[rel_id]
            sheet_path = target.lstrip("/")
            if not sheet_path.startswith("xl/"):
                sheet_path = "xl/" + sheet_path
            root = ET.fromstring(archive.read(sheet_path))
            rows = []
            for row in root.findall(".//main:sheetData/main:row", ns):
                values = []
                for cell in row.findall("main:c", ns):
                    cell_type = cell.attrib.get("t")
                    if cell_type == "inlineStr":
                        text = "".join(node.text or "" for node in cell.findall(".//main:t", ns))
                        values.append(text)
                    elif cell_type == "s":
                        index = int(cell.findtext("main:v", default="0", namespaces=ns))
                        values.append(shared_strings[index])
                    else:
                        raw = cell.findtext("main:v", default="", namespaces=ns)
                        if raw.isdigit():
                            values.append(int(raw))
                        else:
                            try:
                                values.append(float(raw))
                            except ValueError:
                                values.append(raw)
                rows.append(values)
            sheets[name] = rows
    return sheets


def test_report_exports_generate_downloadable_files(monkeypatch, tmp_path):
    client, _main, models, database = build_client(monkeypatch, tmp_path)
    with client as test_client:
        project_id = seed_project(database, models)
        for fmt, magic in [("docx", b"PK"), ("xlsx", b"PK"), ("pdf", b"%PDF")]:
            created = test_client.post(f"/api/sca/projects/{project_id}/reports", json={"format": fmt})
            assert created.status_code == 200
            report = created.json()
            assert report["format"] == fmt
            downloaded = test_client.get(f"/api/sca/reports/{report['id']}/download")
            assert downloaded.status_code == 200
            assert downloaded.content.startswith(magic)


def test_report_includes_management_summary_confidence_and_priority(monkeypatch, tmp_path):
    client, _main, models, database = build_client(monkeypatch, tmp_path)
    with client as test_client:
        project_id = seed_project(database, models)
        created = test_client.post(f"/api/sca/projects/{project_id}/reports", json={"format": "docx"})
        report = created.json()
        downloaded = test_client.get(f"/api/sca/reports/{report['id']}/download")

    with zipfile.ZipFile(BytesIO(downloaded.content)) as archive:
        names = set(archive.namelist())
        document = archive.read("word/document.xml").decode("utf-8")

    assert "word/styles.xml" in names
    assert "<w:tbl>" in document
    assert "软件成分分析报告" in document
    assert "报告属性信息" in document
    assert "目  录" in document
    assert "系统基本情况" in document
    assert "组件安全审计结果汇总" in document
    assert "组件安全审计缺陷详情" in document
    assert "组件安全审计清单" in document
    assert "本次扫描结论摘要" in document
    assert "漏洞可信度说明" in document
    assert "整改优先级清单" in document
    assert "开发修复建议" in document
    assert "pip install fastapi==0.115.7" in document


def test_docx_report_uses_export_metadata_and_extended_fields(monkeypatch, tmp_path):
    client, _main, models, database = build_client(monkeypatch, tmp_path)
    with client as test_client:
        project_id = seed_project(database, models)
        created = test_client.post(
            f"/api/sca/projects/{project_id}/reports",
            json={"format": "docx", "metadata": report_metadata()},
        )
        report = created.json()
        downloaded = test_client.get(f"/api/sca/reports/{report['id']}/download")

    with zipfile.ZipFile(BytesIO(downloaded.content)) as archive:
        document = archive.read("word/document.xml").decode("utf-8")

    assert "聚信测试委托单位" in document
    assert "聚信安全审计中心" in document
    assert "审计专员01" in document
    assert "V2.0" in document
    assert "CWE-79" in document
    assert "版本日期" in document
    assert "组件年龄" in document


def test_xlsx_report_matches_reference_workbook_with_metadata_and_license_policy(monkeypatch, tmp_path):
    client, _main, models, database = build_client(monkeypatch, tmp_path)
    with client as test_client:
        project_id = seed_project(database, models)
        with database.SessionLocal() as db:
            component = db.query(models.Component).filter_by(project_id=project_id, package_name="fastapi").one()
            db.add(
                models.RiskMonitorSnapshot(
                    project_id=project_id,
                    component_id=component.id,
                    component_name=component.package_name,
                    current_version=component.package_version,
                    latest_version="0.115.7",
                    latest_source="pypi",
                    update_available=True,
                    version_delta="patch",
                    current_version_published_at="2024-12-01",
                    component_age_years=1.5,
                    vulnerability_count=1,
                    risk_level="high",
                    recommendation="建议升级到 0.115.7",
                )
            )
            db.commit()
        created = test_client.post(
            f"/api/sca/projects/{project_id}/reports",
            json={"format": "xlsx", "metadata": report_metadata()},
        )
        report = created.json()
        downloaded = test_client.get(f"/api/sca/reports/{report['id']}/download")

    sheets = workbook_values(downloaded.content)
    assert list(sheets) == ["任务信息", "审计概览", "审计资产列表", "资产漏洞信息", "许可协议信息"]
    assert ["项目名称", "报告项目"] in sheets["任务信息"]
    assert ["审计人员", "审计专员01"] in sheets["任务信息"]
    assert ["高危组件", 1] in sheets["审计概览"]
    assert ["无漏洞组件", 0] in sheets["审计概览"]
    assert sheets["审计资产列表"][0] == ["组件", "版本", "是否最新版本", "最新版本", "组ID", "组件类型", "组件路径", "许可证", "风险等级", "漏洞分布", "依赖关系", "推荐版本"]
    assert ["fastapi", "0.115.6", "否", "0.115.7", "fastapi", "开源组件", "requirements.txt", "MIT", "高危风险", "严重0；高危1；中危0；低危0", "直接引入", "0.115.7"] in sheets["审计资产列表"]
    assert sheets["资产漏洞信息"][0][:12] == ["漏洞编号", "严重程度", "发布日期", "CWE", "项目名", "组件", "版本", "漏洞利用难度", "创建日期", "组ID", "版本日期", "组件年龄"]
    assert ["CVE-2024-9999", "高危风险", "2024-05-01", "CWE-79", "报告项目 v1.0", "fastapi", "0.115.6", "容易", "2026.06.04", "fastapi", "2024-12-01", "1.5年"] in sheets["资产漏洞信息"]
    license_rows = sheets["许可协议信息"]
    assert license_rows[1] == ["许可协议简称", "许可协议全称", "风险说明", "使用范围", "使用条件", "使用限制", "是否兼容GPL", "OSI认证", "FSF认证", "风险等级", "许可描述"]
    assert any(row[0] == "MIT" and row[10] for row in license_rows)


def test_sbom_export_uses_database_components_when_tool_is_unavailable(monkeypatch, tmp_path):
    client, _main, models, database = build_client(monkeypatch, tmp_path)
    with client as test_client:
        project_id = seed_project(database, models)
        created = test_client.post(f"/api/sca/projects/{project_id}/sbom", json={"format": "cyclonedx"})
        assert created.status_code == 200
        sbom = created.json()
        assert sbom["format"] == "cyclonedx"
        assert sbom["component_count"] == 1
        downloaded = test_client.get(f"/api/sca/sbom/{sbom['id']}/download")
        assert downloaded.status_code == 200
        assert b"fastapi" in downloaded.content


def test_image_scan_reports_missing_tools_without_crashing(monkeypatch, tmp_path):
    client, _main, _models, _database = build_client(monkeypatch, tmp_path)
    with client as test_client:
        response = test_client.post("/api/sca/image-scans", json={"image_ref": "python:3.12-alpine", "scanner": "trivy"})

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "tool_missing"
    assert data["risk_score"] == 0
