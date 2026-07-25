import pytest
from pydantic import ValidationError

from app.agent_contracts import (
    AgentArtifactContract,
    AgentCitationContract,
    AgentEventContract,
    AgentEventType,
    AgentRunContract,
    AgentRunStage,
    AgentRunStatus,
    AgentStepContract,
)
from app.agent_state_machine import AgentRunStateMachine


def test_agent_contracts_serialize_public_run_snapshot() -> None:
    citation = AgentCitationContract(
        citation_id="citation-1",
        name="产品手册.pdf",
        location="第 12 页",
        document_version="2026.07",
    )
    artifact = AgentArtifactContract(
        artifact_id="artifact-1",
        artifact_type="word_document",
        title="专项回复",
        status="ready",
        version=1,
        format="docx",
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        download_ref="/api/artifacts/artifact-1/download",
        downloadable=True,
        editable=True,
    )
    run = AgentRunContract(
        run_id="run-1",
        conversation_id="conversation-1",
        status=AgentRunStatus.SUCCEEDED,
        stage=AgentRunStage.COMPLETED,
        progress=100,
        attempt=2,
        next_action="可下载交付成果",
        artifact=artifact,
        citations=[citation],
    )
    step = AgentStepContract(
        step_id="step-1",
        run_id="run-1",
        sequence=1,
        step_type="retrieve",
        status="succeeded",
    )
    event = AgentEventContract(
        event_id="event-1",
        run_id="run-1",
        sequence=1,
        event_type=AgentEventType.SOURCE,
        stage=AgentRunStage.RETRIEVING,
        label="正在查找资料",
        progress=25,
        source=citation,
    )

    assert run.model_dump(mode="json")["artifact"]["artifact_id"] == "artifact-1"
    assert run.model_dump(mode="json")["artifact"]["downloadable"] is True
    assert run.model_dump(mode="json")["attempt"] == 2
    assert run.model_dump(mode="json")["next_action"] == "可下载交付成果"
    assert run.model_dump(mode="json")["conversation_id"] == "conversation-1"
    assert step.model_dump(mode="json")["sequence"] == 1
    assert event.model_dump(mode="json")["source"]["location"] == "第 12 页"


def test_agent_event_contract_rejects_invalid_progress_and_internal_fields() -> None:
    with pytest.raises(ValidationError):
        AgentEventContract(
            event_id="event-1",
            run_id="run-1",
            sequence=1,
            event_type=AgentEventType.STAGE,
            progress=101,
        )

    with pytest.raises(ValidationError):
        AgentEventContract(
            event_id="event-1",
            run_id="run-1",
            sequence=1,
            event_type=AgentEventType.DELTA,
            chain_of_thought="must not be exposed",
        )


def test_agent_event_contract_requires_public_payload_for_event_type() -> None:
    with pytest.raises(ValidationError):
        AgentEventContract(
            event_id="event-1",
            run_id="run-1",
            sequence=1,
            event_type=AgentEventType.SOURCE,
        )

    with pytest.raises(ValidationError):
        AgentEventContract(
            event_id="event-1",
            run_id="run-1",
            sequence=1,
            event_type=AgentEventType.DELTA,
            source=AgentCitationContract(
                citation_id="citation-1",
                name="产品手册.pdf",
            ),
        )

    with pytest.raises(ValidationError):
        AgentEventContract(
            event_id="event-artifact",
            run_id="run-1",
            sequence=2,
            event_type=AgentEventType.ARTIFACT,
        )

    with pytest.raises(ValidationError):
        AgentEventContract(
            event_id="event-waiting",
            run_id="run-1",
            sequence=3,
            event_type=AgentEventType.WAITING_USER,
        )


def test_waiting_user_contract_and_state_transition() -> None:
    event = AgentEventContract(
        event_id="event-waiting",
        run_id="run-1",
        sequence=1,
        event_type=AgentEventType.WAITING_USER,
        next_action="请补充客户名称后继续",
    )

    assert event.next_action == "请补充客户名称后继续"
    assert AgentRunStateMachine.transition("running", "waiting_user") == "waiting_user"
    assert AgentRunStateMachine.transition("waiting_user", "running") == "running"
