from types import SimpleNamespace

from app.agent_contracts import AgentRunStatus
from app.agent_runtime.native_langgraph_adapter import NativeLangGraphAdapter


def _adapter(payload: dict) -> NativeLangGraphAdapter:
    row = SimpleNamespace(
        status=AgentRunStatus.SUCCEEDED.value,
        result_json=payload,
        error_code="",
        error_message_safe="",
    )
    return NativeLangGraphAdapter(
        runtime=SimpleNamespace(),
        row=row,
        request=SimpleNamespace(),
    )


def test_native_adapter_verify_accepts_grounded_result() -> None:
    verified = _adapter(
        {
            "answer": "根据《安全手册》第 3 页，外出须双人复核。",
            "snippet_count": 1,
        }
    ).verify({})

    assert verified["phase"] == "verified"
    assert verified["outcome"] == "success"
    assert verified["quality"] == {"passed": True, "evidence_count": 1}


def test_native_adapter_verify_rejects_short_answer_even_when_row_succeeded() -> None:
    failed = _adapter({"answer": "太短", "snippet_count": 0}).verify({})

    assert failed["phase"] == "failed"
    assert failed["error_code"] == "NATIVE_RESULT_QUALITY_FAILED"
    assert "回答过短或不完整" in failed["quality_issues"]


def test_native_adapter_verify_allows_explicit_no_evidence_refusal() -> None:
    verified = _adapter(
        {
            "answer": "未找到明确依据，暂不做出结论。",
            "kind": "no_evidence_refusal",
            "snippet_count": 0,
        }
    ).verify({})

    assert verified["phase"] == "verified"
    assert verified["outcome"] == "success"
