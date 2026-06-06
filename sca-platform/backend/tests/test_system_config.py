import importlib

import httpx
from fastapi.testclient import TestClient


def build_client(monkeypatch, tmp_path):
    db_path = tmp_path / "sca-system-config-test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("AUTH_DEV_BYPASS", "true")
    monkeypatch.setenv("CELERY_TASK_ALWAYS_EAGER", "true")
    monkeypatch.setenv("UPLOAD_ROOT", str(tmp_path / "uploads"))
    monkeypatch.setenv("OPENAI_API_KEY", "")
    monkeypatch.setenv("DEPENDENCY_TRACK_API_KEY", "")

    from app import config

    config.get_settings.cache_clear()
    import app.database as database
    import app.models as models
    import app.ai_triage_service as ai_triage_service
    import app.main as main

    importlib.reload(database)
    importlib.reload(models)
    importlib.reload(ai_triage_service)
    importlib.reload(main)
    return TestClient(main.app), main, models, database


def seed_vulnerability(database, models):
    with database.SessionLocal() as db:
        project = models.Project(name="系统配置测试", scan_note="AI 配置")
        db.add(project)
        db.flush()
        component = models.Component(
            project_id=project.id,
            package_name="fastapi",
            package_version="0.100.0",
            ecosystem="pypi",
            license_name="MIT",
        )
        db.add(component)
        db.flush()
        vulnerability = models.VulnerabilityRecord(
            project_id=project.id,
            component_id=component.id,
            source="osv",
            advisory_id="CVE-2026-0001",
            cve_id="CVE-2026-0001",
            package_name="fastapi",
            package_version="0.100.0",
            ecosystem="pypi",
            cvss_score=8.1,
            severity="high",
            description="测试漏洞",
            fixed_version="0.110.0",
        )
        db.add(vulnerability)
        db.commit()
        return project.id, vulnerability.id


def test_system_config_masks_key_and_enforces_upload_limit(monkeypatch, tmp_path):
    client, _main, _models, _database = build_client(monkeypatch, tmp_path)

    with client as test_client:
        defaults = test_client.get("/api/sca/system-config").json()
        assert defaults["upload_max_file_size_mb"] > 0
        assert defaults["openai_api_key_configured"] is False
        assert defaults["dependency_track_api_key_configured"] is False

        saved = test_client.put(
            "/api/sca/system-config",
            json={
                "upload_max_file_size_mb": 1,
                "openai_api_key": "example-openai-api-key",
                "openai_base_url": "https://llm.example.com/v1",
                "openai_model": "deepseek-chat",
                "openai_timeout_ms": 45000,
                "dependency_track_url": "http://dependency-track.local",
                "dependency_track_api_key": "example-dtrack-api-key",
            },
        )
        assert saved.status_code == 200
        assert saved.json()["openai_api_key_configured"] is True
        assert saved.json()["dependency_track_api_key_configured"] is True
        assert "example-openai-api-key" not in str(saved.json())
        assert "example-dtrack-api-key" not in str(saved.json())
        assert saved.json()["openai_api_key_masked"].startswith("exam")
        assert saved.json()["dependency_track_api_key_masked"].startswith("exam")

        too_large = test_client.post(
            "/api/sca/uploads/sessions",
            json={
                "project_name": "too-large",
                "scan_note": "",
                "filename": "source.zip",
                "total_size": 2 * 1024 * 1024,
                "total_chunks": 1,
            },
        )
        assert too_large.status_code == 413


def test_ai_triage_uses_runtime_system_config(monkeypatch, tmp_path):
    client, main, models, database = build_client(monkeypatch, tmp_path)
    captured = {}

    def fake_analyze(vulnerabilities, context, settings):
        captured["api_key"] = settings.openai_api_key
        captured["api_url"] = settings.openai_api_url
        captured["model"] = settings.openai_model
        captured["timeout"] = settings.openai_timeout_ms
        return [
            {
                "vulnerability_id": vulnerabilities[0].id,
                "ai_risk_level": "P1",
                "noise_reason": "使用系统配置模型",
                "immediate_fix": True,
                "suspected_false_positive": False,
                "remediation": "升级版本",
                "fix_deadline": "3天内",
                "risk_explanation": "公网服务",
                "priority_score": 90,
                "token_usage": {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3},
                "model": settings.openai_model,
                "raw": {"ok": True},
            }
        ]

    monkeypatch.setattr(main, "analyze_vulnerabilities_with_ai", fake_analyze)
    with client as test_client:
        project_id, vulnerability_id = seed_vulnerability(database, models)
        test_client.put(
            "/api/sca/system-config",
            json={
                "upload_max_file_size_mb": 50,
                "openai_api_key": "example-runtime-openai-key",
                "openai_base_url": "https://llm.example.com/v1",
                "openai_model": "qwen-plus",
                "openai_timeout_ms": 65000,
            },
        )
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

    assert response.status_code == 200
    assert captured == {
        "api_key": "example-runtime-openai-key",
        "api_url": "https://llm.example.com/v1/chat/completions",
        "model": "qwen-plus",
        "timeout": 65000,
    }


def test_ai_triage_reports_provider_auth_failure_without_500(monkeypatch, tmp_path):
    client, main, models, database = build_client(monkeypatch, tmp_path)

    def fake_analyze(_vulnerabilities, _context, settings):
        request = httpx.Request("POST", settings.openai_api_url)
        response = httpx.Response(401, request=request, json={"error": {"message": "invalid api key"}})
        raise httpx.HTTPStatusError("auth failed", request=request, response=response)

    monkeypatch.setattr(main, "analyze_vulnerabilities_with_ai", fake_analyze)
    with client as test_client:
        project_id, vulnerability_id = seed_vulnerability(database, models)
        test_client.put(
            "/api/sca/system-config",
            json={
                "upload_max_file_size_mb": 50,
                "openai_api_key": "example-runtime-openai-key",
                "openai_base_url": "https://api.deepseek.com",
                "openai_model": "deepseek-chat",
                "openai_timeout_ms": 30000,
            },
        )
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

    assert response.status_code == 502
    assert response.json()["code"] == "GATEWAY_OR_BACKEND_UNAVAILABLE"
    assert "模型服务认证失败" in response.json()["message"]
    assert "invalid api key" in response.json()["message"]


def test_system_config_can_test_openai_model_without_saving(monkeypatch, tmp_path):
    client, _main, _models, _database = build_client(monkeypatch, tmp_path)
    captured = {}

    class FakeResponse:
        status_code = 200
        content = b'{"choices":[{"message":{"content":"{\\"items\\":[]}"}}],"usage":{"total_tokens":3}}'

        def raise_for_status(self):
            return None

        def json(self):
            return {"choices": [{"message": {"content": '{"items":[]}'}}], "usage": {"total_tokens": 3}}

    class FakeClient:
        def __init__(self, timeout):
            captured["timeout"] = timeout

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def post(self, url, headers, json):
            captured["url"] = url
            captured["auth"] = headers.get("Authorization", "")
            captured["model"] = json.get("model")
            captured["response_format"] = json.get("response_format", {}).get("type")
            return FakeResponse()

    monkeypatch.setattr("app.main.httpx.Client", FakeClient)
    with client as test_client:
        response = test_client.post(
            "/api/sca/system-config/test-openai",
            json={
                "upload_max_file_size_mb": 50,
                "openai_api_key": "example-unsaved-openai-key",
                "openai_base_url": "https://llm.example.com/v1/chat/completions",
                "openai_model": "model-test",
                "openai_timeout_ms": 12000,
            },
        )
        config_after = test_client.get("/api/sca/system-config").json()

    assert response.status_code == 200
    assert response.json()["success"] is True
    assert response.json()["model"] == "model-test"
    assert captured == {
        "timeout": 12,
        "url": "https://llm.example.com/v1/chat/completions",
        "auth": "Bearer example-unsaved-openai-key",
        "model": "model-test",
        "response_format": "json_schema",
    }
    assert config_after["openai_api_key_configured"] is False


def test_dependency_track_license_catalog_sync_uses_runtime_config(monkeypatch, tmp_path):
    client, _main, models, database = build_client(monkeypatch, tmp_path)
    captured = {}

    class FakeDependencyTrackClient:
        def __init__(self, settings):
            captured["url"] = settings.dependency_track_url
            captured["api_key"] = settings.dependency_track_api_key

        def enabled(self):
            return True

        def fetch_licenses(self):
            return [
                {
                    "licenseId": "MIT",
                    "name": "MIT License",
                    "isOsiApproved": True,
                    "isFsfLibre": True,
                    "isDeprecatedLicenseId": False,
                    "seeAlso": ["https://opensource.org/license/mit"],
                },
                {
                    "licenseId": "GPL-3.0-only",
                    "name": "GNU General Public License v3.0 only",
                    "isOsiApproved": True,
                    "isFsfLibre": True,
                    "isDeprecatedLicenseId": False,
                },
            ]

    monkeypatch.setattr("app.main.DependencyTrackClient", FakeDependencyTrackClient)
    with client as test_client:
        saved = test_client.put(
            "/api/sca/system-config",
            json={
                "upload_max_file_size_mb": 50,
                "dependency_track_url": "http://dependency-track.local",
                "dependency_track_api_key": "example-dtrack-runtime-key",
            },
        )
        response = test_client.post("/api/sca/licenses/sync")
        licenses = test_client.get("/api/sca/licenses").json()

    assert saved.status_code == 200
    assert response.status_code == 200
    assert response.json()["synced"] == 2
    assert captured == {"url": "http://dependency-track.local", "api_key": "example-dtrack-runtime-key"}
    assert [item["license_id"] for item in licenses] == ["GPL-3.0-only", "MIT"]
    assert licenses[1]["name"] == "MIT License"
    assert licenses[1]["osi_approved"] is True
    with database.SessionLocal() as db:
        assert db.query(models.DependencyTrackLicense).count() == 2


def test_dependency_track_license_sync_reports_missing_api_key(monkeypatch, tmp_path):
    client, _main, _models, _database = build_client(monkeypatch, tmp_path)
    with client as test_client:
        response = test_client.post("/api/sca/licenses/sync")

    assert response.status_code == 400
    assert "Dependency-Track API Key" in response.json()["detail"]
