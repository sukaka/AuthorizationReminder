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
    )
    run = AgentRunContract(
        run_id="run-1",
        status=AgentRunStatus.SUCCEEDED,
        stage=AgentRunStage.COMPLETED,
        progress=100,
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
