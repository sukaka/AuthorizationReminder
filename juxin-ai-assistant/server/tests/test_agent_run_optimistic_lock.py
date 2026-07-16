from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError
from sqlalchemy.pool import StaticPool


def test_agent_run_rejects_stale_concurrent_state_write():
    from app import models  # noqa: F401
    from app.database import Base
    from app.models import AgentRun

    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    try:
        with Session(engine, expire_on_commit=False) as creator:
            run = AgentRun(
                owner_user_id="user-1",
                request_ciphertext=b"request",
                request_nonce=b"nonce",
            )
            creator.add(run)
            creator.commit()
            run_id = run.id

        with Session(engine, expire_on_commit=False) as first, Session(
            engine, expire_on_commit=False
        ) as second:
            first_copy = first.get(AgentRun, run_id)
            stale_copy = second.get(AgentRun, run_id)
            assert first_copy is not None
            assert stale_copy is not None

            first_copy.progress = 10
            first.commit()

            stale_copy.progress = 20
            try:
                second.commit()
            except StaleDataError:
                second.rollback()
            else:
                raise AssertionError("stale AgentRun write must be rejected")
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()
