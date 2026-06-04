import importlib


class FakeResponse:
    def __init__(self, payload=None, text=""):
        self._payload = payload or {}
        self.text = text

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class FakeClient:
    def __init__(self, *args, **kwargs):
        self.requests = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def get(self, url):
        self.requests.append(url)
        if "registry.npmjs.org" in url:
            return FakeResponse({"license": "Apache License 2.0"})
        if "pypi.org" in url:
            return FakeResponse({"info": {"license": "Dual License", "classifiers": ["License :: OSI Approved :: MIT License"]}})
        if "repo1.maven.org" in url:
            return FakeResponse(text="<project><licenses><license><name>Eclipse Public License 2.0</name></license></licenses></project>")
        return FakeResponse({})


def build_database(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'license-test.db'}")
    monkeypatch.setenv("AUTH_DEV_BYPASS", "true")

    from app import config

    config.get_settings.cache_clear()
    import app.database as database
    import app.models as models
    import app.license_enrichment_service as license_enrichment_service

    importlib.reload(database)
    importlib.reload(models)
    importlib.reload(license_enrichment_service)
    database.init_db()
    return database, models, license_enrichment_service


def test_license_policy_normalizes_common_aliases_and_spdx_expressions():
    from app.license_policy import license_policy, normalize_license_name

    assert normalize_license_name("Apache License 2.0") == "Apache-2.0"
    assert normalize_license_name("MIT OR Apache License 2.0") == "MIT OR Apache-2.0"
    assert license_policy("LGPL-2.1-only").risk_level == "中风险"
    assert license_policy("Mulan Permissive Software License, Version 2").short_name == "MulanPSL-2.0"


def test_license_enrichment_fills_missing_licenses_from_registries(monkeypatch, tmp_path):
    database, models, license_enrichment_service = build_database(monkeypatch, tmp_path)
    monkeypatch.setattr(license_enrichment_service.httpx, "Client", FakeClient)

    with database.SessionLocal() as db:
        project = models.Project(name="license-demo")
        db.add(project)
        db.flush()
        db.add_all(
            [
                models.Component(project_id=project.id, package_name="axios", package_version="1.6.0", ecosystem="npm", license_name="未声明"),
                models.Component(project_id=project.id, package_name="requests", package_version="2.32.3", ecosystem="pypi", license_name="unknown"),
                models.Component(
                    project_id=project.id,
                    package_name="org.eclipse.jetty:jetty-server",
                    package_version="12.0.0",
                    ecosystem="maven",
                    group_id="org.eclipse.jetty",
                    artifact_id="jetty-server",
                    license_name="",
                ),
            ]
        )
        db.commit()
        project_id = project.id

    with database.SessionLocal() as db:
        stats = license_enrichment_service.enrich_missing_component_licenses(db, project_id)
        rows = {component.package_name: component for component in db.query(models.Component).order_by(models.Component.package_name)}
        cache_count = db.query(models.PackageLicenseCache).count()

    assert stats["updated"] == 3
    assert rows["axios"].license_name == "Apache-2.0"
    assert rows["axios"].license_source == "npm_registry"
    assert rows["axios"].license_confidence >= 0.9
    assert rows["requests"].license_name == "MIT"
    assert rows["requests"].license_source == "pypi_registry"
    assert rows["org.eclipse.jetty:jetty-server"].license_name == "EPL-2.0"
    assert rows["org.eclipse.jetty:jetty-server"].license_source == "maven_pom"
    assert cache_count == 3
