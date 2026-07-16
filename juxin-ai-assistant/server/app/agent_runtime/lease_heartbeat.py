"""Independent durable lease heartbeat for long-running agent workers."""

from __future__ import annotations

from threading import Event, Thread
from typing import Any

from sqlalchemy.orm import Session, sessionmaker

from ..agent_run_service import AgentRunService
from ..crypto import ContentCipher


class LeaseHeartbeat:
    """Renew a run lease from an independent session every fixed interval."""

    def __init__(
        self,
        bind: Any,
        cipher: ContentCipher,
        *,
        run_id: str,
        worker_id: str,
        fencing_token: int,
        interval_seconds: float = 5.0,
        ttl_seconds: int = 20,
    ) -> None:
        if interval_seconds <= 0 or ttl_seconds <= 0:
            raise ValueError("heartbeat_interval_and_ttl_must_be_positive")
        self._sessions = sessionmaker(bind=bind, autoflush=False, expire_on_commit=False)
        self._cipher = cipher
        self.run_id = run_id
        self.worker_id = worker_id
        self.fencing_token = fencing_token
        self.interval_seconds = interval_seconds
        self.ttl_seconds = ttl_seconds
        self._stopped = Event()
        self._lost = Event()
        self._thread: Thread | None = None

    @property
    def lost(self) -> bool:
        return self._lost.is_set()

    def renew_once(self) -> bool:
        """Run one fenced renewal in a fresh transaction."""

        with self._sessions() as db:
            service = AgentRunService(db, self._cipher)
            renewed = service.renew_lease(
                self.run_id,
                self.worker_id,
                self.fencing_token,
                ttl_seconds=self.ttl_seconds,
            )
            if renewed:
                db.commit()
                return True
            db.rollback()
        self._lost.set()
        return False

    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = Thread(target=self._run, name=f"agent-lease-{self.run_id}", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stopped.set()
        if self._thread is not None:
            self._thread.join(timeout=min(self.interval_seconds + 1, 10))

    def _run(self) -> None:
        while not self._stopped.wait(self.interval_seconds):
            try:
                if not self.renew_once():
                    return
            except Exception:
                self._lost.set()
                return
