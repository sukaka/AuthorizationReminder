import importlib

from fastapi.testclient import TestClient


def build_client(monkeypatch, tmp_path):
    db_path = tmp_path / "sca-test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("AUTH_DEV_BYPASS", "true")
    monkeypatch.setenv("APP_VERSION", "0.1.0")
    monkeypatch.setenv("OPENAI_API_KEY", "")

    from app import config

    config.get_settings.cache_clear()
    import app.database as database
    import app.models as models
    import app.ai_triage_service as ai_triage_service
    import app.asset_service as asset_service
    import app.main as main

    importlib.reload(database)
    importlib.reload(models)
    importlib.reload(ai_triage_service)
    importlib.reload(asset_service)
    importlib.reload(main)
    return TestClient(main.app), main, models, database


def seed_vulnerability(database, models):
    with database.SessionLocal() as db:
        project = models.Project(name="AI项目", scan_note="公网核心业务")
        db.add(project)
        db.flush()
        component = models.Component(
            project_id=project.id,
            package_name="spring-core",
            package_version="5.3.0",
            ecosystem="maven",
            scope="runtime",
            license_name="Apache-2.0",
        )
        db.add(component)
        db.flush()
        vulnerability = models.VulnerabilityRecord(
            project_id=project.id,
            component_id=component.id,
            source="osv",
            advisory_id="CVE-2024-1111",
            cve_id="CVE-2024-1111",
            package_name="spring-core",
            package_version="5.3.0",
            ecosystem="maven",
            cvss_score=8.8,
            severity="high",
            description="远程代码执行漏洞，影响公网接口",
            fixed_version="5.3.30",
            published_at_text="2024-06-01T00:00:00Z",
            has_poc=True,
            exploited_in_wild=True,
        )
        db.add(vulnerability)
        db.commit()
        return project.id, vulnerability.id


def test_ai_prompt_redacts_sensitive_values():
    from app.ai_triage_service import sanitize_for_ai

    data = sanitize_for_ai({"url": "https://user:secret@example.com", "token": "abc123", "note": "normal"})

    assert data["token"] == "[REDACTED]"
    assert "secret" not in data["url"]
    assert data["note"] == "normal"


def test_ai_triage_uses_json_result_and_records_tokens(monkeypatch, tmp_path):
    client, main, models, database = build_client(monkeypatch, tmp_path)

    def fake_analyze(vulnerabilities, context, settings):
        return [
            {
                "vulnerability_id": vulnerabilities[0].id,
                "ai_risk_level": "P0",
                "noise_reason": "公网核心业务且存在在野利用",
                "immediate_fix": True,
                "suspected_false_positive": False,
                "remediation": "立即升级到修复版本",
                "fix_deadline": "24小时内",
                "risk_explanation": "运行路径可达",
                "priority_score": 98,
                "token_usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150},
                "model": "gpt-test",
                "raw": {"ok": True},
            }
        ]

    monkeypatch.setattr(main, "analyze_vulnerabilities_with_ai", fake_analyze)
    with client as test_client:
        project_id, vulnerability_id = seed_vulnerability(database, models)
        response = test_client.post(
            f"/api/sca/projects/{project_id}/ai-triage/analyze",
            json={
                "vulnerability_ids": [vulnerability_id],
                "context": {
                    "internet_exposed": True,
                    "core_business": True,
                    "actually_called": True,
                    "runtime_path": True,
                    "has_waf_ips": False,
                    "fix_complexity": "medium",
                },
            },
        )
        confirmed = test_client.post(f"/api/sca/ai-triage/{response.json()[0]['id']}/confirm", json={"human_status": "accepted"})

    assert response.status_code == 200
    assert response.json()[0]["ai_risk_level"] == "P0"
    assert response.json()[0]["token_total"] == 150
    assert confirmed.json()["human_status"] == "accepted"


def test_asset_dashboard_and_search(monkeypatch, tmp_path):
    client, main, models, database = build_client(monkeypatch, tmp_path)
    with client as test_client:
        project_id, _vulnerability_id = seed_vulnerability(database, models)
        with database.SessionLocal() as db:
            component = db.query(models.Component).filter_by(project_id=project_id).first()
            db.add(
                models.RiskMonitorSnapshot(
                    project_id=project_id,
                    component_id=component.id,
                    component_name=component.package_name,
                    current_version=component.package_version,
                    latest_version="6.0.0",
                    update_available=True,
                    eol_status="eol",
                    vulnerability_count=1,
                    risk_level="high",
                    recommendation="升级主版本",
                )
            )
            db.commit()

        dashboard = test_client.get("/api/sca/assets/dashboard").json()
        components = test_client.get("/api/sca/assets/components?search=spring").json()
        graph = test_client.get("/api/sca/assets/graph").json()

    assert dashboard["component_total"] == 1
    assert dashboard["vulnerability_total"] == 1
    assert dashboard["eol_total"] == 1
    assert components["items"][0]["package_name"] == "spring-core"
    assert graph["nodes"]
