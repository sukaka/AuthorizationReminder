from collections.abc import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()
connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, pool_pre_ping=True, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from . import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    run_compat_migrations()


def run_compat_migrations() -> None:
    inspector = inspect(engine)
    if not inspector.has_table("components"):
        return
    existing = {column["name"] for column in inspector.get_columns("components")}
    additions = {
        "ecosystem": "VARCHAR(40) NOT NULL DEFAULT 'unknown'",
        "scope": "VARCHAR(40) NOT NULL DEFAULT 'runtime'",
        "source_path": "VARCHAR(512) NOT NULL DEFAULT ''",
    }
    with engine.begin() as conn:
        for foreign_key in inspector.get_foreign_keys("components"):
            if foreign_key.get("referred_table") == "analysis_projects" and foreign_key.get("constrained_columns") == ["project_id"]:
                name = foreign_key.get("name")
                if name and engine.dialect.name == "postgresql":
                    conn.execute(text(f'ALTER TABLE components DROP CONSTRAINT IF EXISTS "{name}"'))
        for column, definition in additions.items():
            if column not in existing:
                conn.execute(text(f"ALTER TABLE components ADD COLUMN {column} {definition}"))


def check_database() -> bool:
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return True
