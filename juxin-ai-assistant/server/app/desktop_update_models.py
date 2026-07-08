import uuid as uuid_lib
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base

primary_key_type = BigInteger().with_variant(Integer, "sqlite")


class DesktopUpdateRelease(Base):
    __tablename__ = "ai_desktop_update_releases"
    __table_args__ = (
        UniqueConstraint(
            "channel",
            "agent_version",
            name="uq_desktop_update_release_channel_version",
        ),
        CheckConstraint(
            "channel IN ('lan-test', 'production')",
            name="ck_desktop_update_release_channel",
        ),
        CheckConstraint(
            "status IN ('DRAFT', 'PUBLISHED', 'WITHDRAWN')",
            name="ck_desktop_update_release_status",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    agent_version: Mapped[str] = mapped_column(String(32), index=True)
    channel: Mapped[str] = mapped_column(String(16), index=True)
    status: Mapped[str] = mapped_column(String(16), default="DRAFT", index=True)
    release_notes: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        nullable=False,
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class DesktopUpdateArtifact(Base):
    __tablename__ = "ai_desktop_update_artifacts"
    __table_args__ = (
        UniqueConstraint(
            "release_id",
            "target",
            name="uq_desktop_update_artifact_release_target",
        ),
        CheckConstraint(
            "target IN ('darwin-aarch64', 'windows-x86_64')",
            name="ck_desktop_update_artifact_target",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    release_id: Mapped[int] = mapped_column(
        primary_key_type,
        nullable=False,
        index=True,
    )
    target: Mapped[str] = mapped_column(String(32))
    file_name: Mapped[str] = mapped_column(String(255))
    storage_key: Mapped[str] = mapped_column(String(64), unique=True)
    content_type: Mapped[str] = mapped_column(String(64))
    size_bytes: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"))
    sha256: Mapped[str] = mapped_column(String(64), unique=True)
    tauri_signature: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        nullable=False,
    )
