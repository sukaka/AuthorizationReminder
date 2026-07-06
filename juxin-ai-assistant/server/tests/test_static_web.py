from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.static_web import mount_static_web


def test_static_web_serves_index_for_spa_route(tmp_path: Path):
    dist = tmp_path / "dist"
    assets = dist / "assets"
    assets.mkdir(parents=True)
    (dist / "index.html").write_text("<div id='root'></div>", encoding="utf-8")
    (assets / "app.js").write_text("console.log('ok')", encoding="utf-8")

    app = FastAPI()
    mount_static_web(app, static_dir=str(dist), enabled=True)
    client = TestClient(app)

    response = client.get("/history")

    assert response.status_code == 200
    assert "<div id='root'></div>" in response.text


def test_static_web_does_not_capture_api_routes(tmp_path: Path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("index", encoding="utf-8")

    app = FastAPI()
    mount_static_web(app, static_dir=str(dist), enabled=True)
    client = TestClient(app)

    response = client.get("/api/ai/session")

    assert response.status_code == 404


def test_static_web_disabled_returns_404(tmp_path: Path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("index", encoding="utf-8")

    app = FastAPI()
    mount_static_web(app, static_dir=str(dist), enabled=False)
    client = TestClient(app)

    response = client.get("/")

    assert response.status_code == 404
