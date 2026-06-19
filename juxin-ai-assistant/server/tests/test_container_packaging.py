from pathlib import Path


SERVER_ROOT = Path(__file__).resolve().parents[1]


def test_server_image_packages_migrations_and_bootstrap_script() -> None:
    dockerfile = (SERVER_ROOT / "Dockerfile").read_text(encoding="utf-8")

    assert "COPY alembic.ini ./alembic.ini" in dockerfile
    assert "COPY alembic ./alembic" in dockerfile
    assert "COPY scripts ./scripts" in dockerfile
