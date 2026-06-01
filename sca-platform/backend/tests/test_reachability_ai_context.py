from pathlib import Path


def test_reachability_detects_python_import_and_routes(tmp_path):
    source = tmp_path / "src"
    source.mkdir()
    (source / "main.py").write_text(
        """
from fastapi import FastAPI
import requests

app = FastAPI()

@app.get("/health")
def health():
    return requests.get("https://example.com").status_code
""",
        encoding="utf-8",
    )

    from app.models import Component
    from app.reachability_service import analyze_component_reachability

    component = Component(package_name="requests", normalized_name="requests", package_version="2.31.0", ecosystem="pypi", project_id=1)
    result = analyze_component_reachability(component, source)

    assert result.reachability_status == "reachable"
    assert "main.py:3" in result.reachability_evidence
    assert "/health" in result.entry_points
    assert "main.py" in result.related_files
    assert "requests" in result.call_path_summary


def test_reachability_marks_not_found_when_entry_exists_without_import(tmp_path):
    source = tmp_path / "src"
    source.mkdir()
    (source / "UserController.java").write_text(
        """
package demo;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
class UserController {
  @GetMapping("/users")
  String users() { return "ok"; }
}
""",
        encoding="utf-8",
    )

    from app.models import Component
    from app.reachability_service import analyze_component_reachability

    component = Component(
        package_name="org.apache.commons:commons-lang3",
        group_id="org.apache.commons",
        artifact_id="commons-lang3",
        package_version="3.14.0",
        ecosystem="maven",
        project_id=1,
    )
    result = analyze_component_reachability(component, source)

    assert result.reachability_status == "not_found"
    assert "未发现调用证据" in result.call_path_summary
    assert "/users" in result.entry_points


def test_ai_prompt_uses_structured_context_and_reuses_cached_result(monkeypatch, tmp_path):
    import importlib

    db_path = tmp_path / "sca-test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("AUTH_DEV_BYPASS", "true")
    monkeypatch.setenv("OPENAI_API_KEY", "")

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
    database.init_db()

    from fastapi.testclient import TestClient

    with database.SessionLocal() as db:
        project = models.Project(name="AI结构化上下文", scan_note="核心业务")
        db.add(project)
        db.flush()
        component = models.Component(project_id=project.id, package_name="requests", package_version="2.31.0", ecosystem="pypi", scope="runtime")
        db.add(component)
        db.flush()
        vulnerability = models.VulnerabilityRecord(
            project_id=project.id,
            component_id=component.id,
            source="osv",
            advisory_id="GHSA-STRUCTURED",
            cve_id="CVE-2026-0002",
            package_name="requests",
            package_version="2.31.0",
            ecosystem="pypi",
            cvss_score=8.8,
            severity="high",
            description="demo",
            fixed_version="2.32.0",
            has_poc=False,
            exploited_in_wild=False,
            match_status="affected",
            matched_by="purl+version_range",
            match_reason="版本范围命中",
            confidence_score=0.94,
            reachability_status="reachable",
            reachability_evidence="main.py:3 import requests",
            entry_points="/health",
            related_files="main.py",
            call_path_summary="FastAPI /health -> requests",
        )
        db.add(vulnerability)
        db.commit()
        project_id = project.id
        vulnerability_id = vulnerability.id

    messages = ai_triage_service.build_prompt([vulnerability], {"internet_exposed": True, "core_business": True})
    prompt_text = messages[-1]["content"]
    assert "matching_evidence" in prompt_text
    assert "reachability" in prompt_text
    assert "CVE-2026-0002" in prompt_text

    with TestClient(main.app) as client:
        first = client.post(
            f"/api/sca/projects/{project_id}/ai-triage/analyze",
            json={"vulnerability_ids": [vulnerability_id], "context": {"internet_exposed": True, "core_business": True}},
        ).json()
        second = client.post(
            f"/api/sca/projects/{project_id}/ai-triage/analyze",
            json={"vulnerability_ids": [vulnerability_id], "context": {"internet_exposed": True, "core_business": True}},
        ).json()

    assert first[0]["ai_schema_version"]
    assert first[0]["input_hash"] == second[0]["input_hash"]
    assert first[0]["id"] == second[0]["id"]
