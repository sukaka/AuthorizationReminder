"""Durable LangGraph checkpoint adapter backed by an independent checkpoint table.

LangGraph's default SQLite saver is useful for a pilot, but it is not suitable
for multi-worker recovery. This adapter stores each graph checkpoint in a
database table and commits it in a short, independent transaction. The run
lease and fencing token are checked while the ``AgentRun`` row is locked, so an
old worker cannot append after a lease takeover.

The implementation is intentionally optional: importing this module does not
require LangGraph, while constructing it does.
"""

from __future__ import annotations

import base64
import threading
from contextlib import contextmanager
from datetime import UTC, datetime
from collections.abc import Iterator, Sequence
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from ..agent_run_service import AgentRunService, LeaseLostError
from ..models import AgentRun, AgentRunLangGraphCheckpoint

try:  # pragma: no cover - exercised in the optional LangGraph environment
    from langgraph.checkpoint.base import (
        BaseCheckpointSaver,
        Checkpoint,
        CheckpointMetadata,
        CheckpointTuple,
        ChannelVersions,
        get_checkpoint_metadata,
    )

    LANGGRAPH_CHECKPOINT_BASE_AVAILABLE = True
except Exception:  # pragma: no cover - default installation intentionally omits LangGraph
    BaseCheckpointSaver = object  # type: ignore[misc,assignment]
    Checkpoint = dict[str, Any]  # type: ignore[misc,assignment]
    CheckpointMetadata = dict[str, Any]  # type: ignore[misc,assignment]
    CheckpointTuple = Any  # type: ignore[misc,assignment]
    ChannelVersions = dict[str, Any]  # type: ignore[misc,assignment]
    get_checkpoint_metadata = None  # type: ignore[assignment]
    LANGGRAPH_CHECKPOINT_BASE_AVAILABLE = False


class AgentRunCheckpointSaver(BaseCheckpointSaver):
    """Persist one LangGraph thread with independent transactions."""

    _PAYLOAD_KEY = "langgraph_checkpoint"

    def __init__(
        self,
        service: AgentRunService,
        row: AgentRun,
        *,
        worker_id: str,
        fencing_token: int,
    ) -> None:
        if not LANGGRAPH_CHECKPOINT_BASE_AVAILABLE:
            raise RuntimeError("LangGraph checkpoint dependency is not installed")
        super().__init__()
        self.service = service
        self.row = row
        self.worker_id = str(worker_id or "").strip()
        self.fencing_token = int(fencing_token)
        self._lock = threading.RLock()
        bind = self.service.db.get_bind()
        self._shared_session = isinstance(getattr(bind, "pool", None), StaticPool)
        self._session_factory = sessionmaker(
            bind=bind,
            autoflush=False,
            expire_on_commit=False,
        )
        if not self.worker_id:
            raise ValueError("worker_id is required")

    @contextmanager
    def _session(self) -> Iterator[Any]:
        """Reuse StaticPool's Session in tests; use a new connection in production."""

        if self._shared_session:
            yield self.service.db
            return
        with self._session_factory() as db:
            yield db

    def _assert_thread(self, config: dict[str, Any]) -> tuple[str, str]:
        configurable = config.get("configurable") or {}
        thread_id = str(configurable.get("thread_id") or "").strip()
        checkpoint_ns = str(configurable.get("checkpoint_ns") or "")
        if not thread_id:
            raise ValueError("LangGraph checkpoint thread_id is required")
        if thread_id != str(self.row.uuid):
            raise ValueError("LangGraph checkpoint thread_id must equal AgentRun uuid")
        return thread_id, checkpoint_ns

    @property
    def execution_lock(self) -> threading.RLock:
        """Lock shared with graph callbacks using the same SQLAlchemy Session."""

        return self._lock

    def _assert_write_lease(self) -> None:
        self.service.assert_lease(self.row, self.worker_id, self.fencing_token)

    def _locked_run(self, db: Any) -> AgentRun:
        now = datetime.now(UTC).replace(tzinfo=None)
        statement = (
            select(AgentRun)
            .where(
                AgentRun.uuid == str(self.row.uuid),
                AgentRun.lease_owner == self.worker_id,
                AgentRun.fencing_token == self.fencing_token,
                AgentRun.lease_expires_at.is_not(None),
                AgentRun.lease_expires_at > now,
            )
            .with_for_update()
        )
        locked = db.execute(statement).scalar_one_or_none()
        if locked is None:
            raise LeaseLostError(f"worker {self.worker_id!r} no longer owns run {self.row.uuid}")
        return locked

    def _current_payload(self) -> dict[str, Any]:
        payload = self.row.checkpoint_json
        if not isinstance(payload, dict):
            return {}
        return dict(payload)

    @staticmethod
    def _record_payload(record: AgentRunLangGraphCheckpoint) -> dict[str, Any]:
        return {
            "thread_id": record.thread_id,
            "checkpoint_ns": record.checkpoint_ns or "",
            "checkpoint_id": record.checkpoint_id,
            "parent_checkpoint_id": record.parent_checkpoint_id,
            "checkpoint": record.checkpoint_json or {},
            "metadata": record.metadata_json or {},
            "pending_writes": record.pending_writes_json or [],
            "new_versions": record.new_versions_json or {},
        }

    def _langgraph_payloads(
        self,
        *,
        thread_id: str | None = None,
        checkpoint_ns: str = "",
        checkpoint_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Read committed checkpoints in newest-first order from a fresh Session.

        ``id`` is the durable insertion sequence for this run, so it is used
        instead of checkpoint-id lexical ordering.  This keeps history
        traversal correct even when a LangGraph checkpoint id is not
        time-sortable.
        """

        with self._session() as db:
            statement = select(AgentRunLangGraphCheckpoint).where(
                AgentRunLangGraphCheckpoint.run_id == str(self.row.uuid),
                AgentRunLangGraphCheckpoint.thread_id == (thread_id or str(self.row.uuid)),
                AgentRunLangGraphCheckpoint.checkpoint_ns == checkpoint_ns,
            )
            if checkpoint_id:
                statement = statement.where(AgentRunLangGraphCheckpoint.checkpoint_id == str(checkpoint_id))
            statement = statement.order_by(AgentRunLangGraphCheckpoint.id.desc())
            records = list(db.execute(statement).scalars())
            if records:
                return [self._record_payload(record) for record in records]

            if checkpoint_id:
                # LangGraph may attach pending writes to the parent config while
                # the checkpoint put is being scheduled; use the latest commit.
                latest = select(AgentRunLangGraphCheckpoint).where(
                    AgentRunLangGraphCheckpoint.run_id == str(self.row.uuid),
                    AgentRunLangGraphCheckpoint.thread_id == (thread_id or str(self.row.uuid)),
                    AgentRunLangGraphCheckpoint.checkpoint_ns == checkpoint_ns,
                ).order_by(AgentRunLangGraphCheckpoint.id.desc())
                record = db.execute(latest.limit(1)).scalar_one_or_none()
                if record is not None:
                    return [self._record_payload(record)]

        # Compatibility fallback for rows written before migration 0045.
        payload = self._current_payload().get(self._PAYLOAD_KEY)
        return [dict(payload)] if isinstance(payload, dict) else []

    def _langgraph_payload(
        self,
        *,
        thread_id: str | None = None,
        checkpoint_ns: str = "",
        checkpoint_id: str | None = None,
    ) -> dict[str, Any]:
        """Read the newest committed checkpoint from a fresh Session."""

        payloads = self._langgraph_payloads(
            thread_id=thread_id,
            checkpoint_ns=checkpoint_ns,
            checkpoint_id=checkpoint_id,
        )
        return payloads[0] if payloads else {}

    @staticmethod
    def _encode(value: Any, serde: Any) -> dict[str, str]:
        type_tag, raw = serde.dumps_typed(value)
        return {
            "type": str(type_tag),
            "value_b64": base64.b64encode(raw).decode("ascii"),
        }

    @staticmethod
    def _decode(value: Any, serde: Any) -> Any:
        if not isinstance(value, dict):
            raise ValueError("invalid encoded LangGraph checkpoint")
        type_tag = value.get("type")
        encoded = value.get("value_b64")
        if not isinstance(type_tag, str) or not isinstance(encoded, str):
            raise ValueError("invalid encoded LangGraph checkpoint")
        return serde.loads_typed((type_tag, base64.b64decode(encoded.encode("ascii"))))

    def _persist_langgraph_payload(self, payload: dict[str, Any]) -> None:
        thread_id = str(payload.get("thread_id") or "")
        checkpoint_ns = str(payload.get("checkpoint_ns") or "")
        checkpoint_id = str(payload.get("checkpoint_id") or "")
        if not thread_id or not checkpoint_id:
            raise ValueError("LangGraph checkpoint identity is required")
        with self._session() as db:
            try:
                self._locked_run(db)
                statement = (
                    select(AgentRunLangGraphCheckpoint)
                    .where(
                        AgentRunLangGraphCheckpoint.run_id == str(self.row.uuid),
                        AgentRunLangGraphCheckpoint.thread_id == thread_id,
                        AgentRunLangGraphCheckpoint.checkpoint_ns == checkpoint_ns,
                        AgentRunLangGraphCheckpoint.checkpoint_id == checkpoint_id,
                    )
                    .with_for_update()
                )
                record = db.execute(statement).scalar_one_or_none()
                values = {
                    "parent_checkpoint_id": payload.get("parent_checkpoint_id"),
                    "checkpoint_json": payload.get("checkpoint") or {},
                    "metadata_json": payload.get("metadata") or {},
                    "pending_writes_json": payload.get("pending_writes") or [],
                    "new_versions_json": payload.get("new_versions") or {},
                    "writer_id": self.worker_id,
                    "fencing_token": self.fencing_token,
                }
                if record is None:
                    db.add(
                        AgentRunLangGraphCheckpoint(
                            run_id=str(self.row.uuid),
                            thread_id=thread_id,
                            checkpoint_ns=checkpoint_ns,
                            checkpoint_id=checkpoint_id,
                            **values,
                        )
                    )
                else:
                    for key, value in values.items():
                        setattr(record, key, value)
                db.commit()
            except Exception:
                db.rollback()
                raise

    def _tuple(self, payload: dict[str, Any], requested_config: dict[str, Any]) -> Any:
        checkpoint = self._decode(payload["checkpoint"], self.serde)
        config = {
            "configurable": {
                "thread_id": payload["thread_id"],
                "checkpoint_ns": payload.get("checkpoint_ns", ""),
                "checkpoint_id": payload["checkpoint_id"],
            }
        }
        if requested_config.get("configurable", {}).get("checkpoint_id"):
            config = requested_config
        parent_id = payload.get("parent_checkpoint_id")
        parent_config = (
            {
                "configurable": {
                    "thread_id": payload["thread_id"],
                    "checkpoint_ns": payload.get("checkpoint_ns", ""),
                    "checkpoint_id": parent_id,
                }
            }
            if parent_id
            else None
        )
        writes = []
        for item in payload.get("pending_writes", []):
            if not isinstance(item, list) or len(item) != 4:
                continue
            task_id, channel, type_tag, value_b64 = item
            writes.append((task_id, channel, self._decode({"type": type_tag, "value_b64": value_b64}, self.serde)))
        return CheckpointTuple(
            config,
            checkpoint,
            dict(payload.get("metadata") or {}),
            parent_config,
            writes,
        )

    def get_tuple(self, config: dict[str, Any]) -> Any:
        thread_id, checkpoint_ns = self._assert_thread(config)
        requested_id = (config.get("configurable") or {}).get("checkpoint_id")
        payload = self._langgraph_payload(
            thread_id=thread_id,
            checkpoint_ns=checkpoint_ns,
            checkpoint_id=str(requested_id) if requested_id else None,
        )
        if not payload:
            return None
        return self._tuple(payload, config)

    def list(
        self,
        config: dict[str, Any] | None,
        *,
        filter: dict[str, Any] | None = None,
        before: dict[str, Any] | None = None,
        limit: int | None = None,
    ) -> Iterator[Any]:
        if config is None:
            return
        thread_id, checkpoint_ns = self._assert_thread(config)
        payloads = self._langgraph_payloads(
            thread_id=thread_id,
            checkpoint_ns=(config.get("configurable") or {}).get("checkpoint_ns") or "",
        )
        if not payloads:
            return

        before_config = (before or {}).get("configurable") or {}
        before_thread_id = str(before_config.get("thread_id") or "").strip()
        before_namespace = str(before_config.get("checkpoint_ns") or "")
        before_id = str(before_config.get("checkpoint_id") or "").strip()
        if before_thread_id and before_thread_id != thread_id:
            return
        if before and before_namespace != checkpoint_ns:
            return
        if before_id:
            boundary = next(
                (
                    index
                    for index, payload in enumerate(payloads)
                    if str(payload.get("checkpoint_id") or "") == before_id
                ),
                None,
            )
            # An unknown boundary must not silently expose an unrelated
            # history.  This is a fail-closed read contract for recovery code.
            if boundary is None:
                return
            payloads = payloads[boundary + 1 :]

        if filter:
            payloads = [
                payload
                for payload in payloads
                if all(
                    (dict(payload.get("metadata") or {}).get(key) == value)
                    for key, value in filter.items()
                )
            ]
        if limit is not None and int(limit) <= 0:
            return
        if limit is not None:
            payloads = payloads[: int(limit)]
        for payload in payloads:
            yield self._tuple(payload, config)

    def put(
        self,
        config: dict[str, Any],
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: ChannelVersions,
    ) -> dict[str, dict[str, str]]:
        with self._lock:
            thread_id, checkpoint_ns = self._assert_thread(config)
            if not isinstance(checkpoint, dict) or not checkpoint.get("id"):
                raise ValueError("LangGraph checkpoint id is required")
            metadata_payload = (
                get_checkpoint_metadata(config, metadata)
                if get_checkpoint_metadata is not None
                else dict(metadata or {})
            )
            previous = self._langgraph_payload(thread_id=thread_id, checkpoint_ns=checkpoint_ns)
            payload = {
                "thread_id": thread_id,
                "checkpoint_ns": checkpoint_ns,
                "checkpoint_id": str(checkpoint["id"]),
                "parent_checkpoint_id": (config.get("configurable") or {}).get("checkpoint_id"),
                "checkpoint": self._encode(checkpoint, self.serde),
                "metadata": dict(metadata_payload or {}),
                "pending_writes": previous.get("pending_writes", []),
                "new_versions": dict(new_versions or {}),
            }
            self._persist_langgraph_payload(payload)
            return {
                "configurable": {
                    "thread_id": thread_id,
                    "checkpoint_ns": checkpoint_ns,
                    "checkpoint_id": str(checkpoint["id"]),
                }
            }

    def put_writes(
        self,
        config: dict[str, Any],
        writes: Sequence[tuple[str, Any]],
        task_id: str,
        task_path: str = "",
    ) -> None:
        with self._lock:
            self._assert_thread(config)
            payload = self._langgraph_payload(
                thread_id=str(self.row.uuid),
                checkpoint_ns=(config.get("configurable") or {}).get("checkpoint_ns") or "",
                checkpoint_id=str((config.get("configurable") or {}).get("checkpoint_id") or "") or None,
            )
            if not payload:
                raise ValueError("LangGraph checkpoint must be written before pending writes")
            encoded = list(payload.get("pending_writes", []))
            for channel, value in writes:
                type_tag, raw = self.serde.dumps_typed(value)
                encoded.append([
                    str(task_id),
                    str(channel),
                    str(type_tag),
                    base64.b64encode(raw).decode("ascii"),
                ])
            payload["pending_writes"] = encoded
            self._persist_langgraph_payload(payload)

    def delete_thread(self, thread_id: str) -> None:
        with self._lock:
            if str(thread_id) != str(self.row.uuid):
                return
            with self._session() as db:
                try:
                    self._locked_run(db)
                    db.query(AgentRunLangGraphCheckpoint).filter(
                        AgentRunLangGraphCheckpoint.run_id == str(self.row.uuid),
                        AgentRunLangGraphCheckpoint.thread_id == str(thread_id),
                    ).delete(synchronize_session=False)
                    db.commit()
                except Exception:
                    db.rollback()
                    raise


def agent_run_checkpoint_saver_available() -> bool:
    """Return whether the optional LangGraph saver base can be imported."""

    return LANGGRAPH_CHECKPOINT_BASE_AVAILABLE
