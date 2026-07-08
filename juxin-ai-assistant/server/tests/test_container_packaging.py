from pathlib import Path


SERVER_ROOT = Path(__file__).resolve().parents[1]
DESKTOP_ROOT = SERVER_ROOT.parents[0] / "apps" / "desktop"


def test_server_image_packages_migrations_and_bootstrap_script() -> None:
    dockerfile = (SERVER_ROOT / "Dockerfile").read_text(encoding="utf-8")

    assert "COPY server/alembic.ini ./alembic.ini" in dockerfile
    assert "COPY server/alembic ./alembic" in dockerfile
    assert "COPY server/scripts ./scripts" in dockerfile


def test_desktop_nginx_proxies_chat_word_export_api() -> None:
    nginx_conf = (DESKTOP_ROOT / "nginx.conf").read_text(encoding="utf-8")

    assert "skills" in nginx_conf
    assert "learning" in nginx_conf
    assert "location ~ ^/api/(ai|export|knowledge|personal-reference|conversations|skills|learning)(/|$)" in nginx_conf
    assert "proxy_pass http://ai-assistant-api:5193;" in nginx_conf


def test_server_image_packages_agent_harness_skills() -> None:
    dockerfile = (SERVER_ROOT / "Dockerfile").read_text(encoding="utf-8")

    assert "COPY agent-harness ./agent-harness" in dockerfile
