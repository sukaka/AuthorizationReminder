from app.agent_runtime.outcome_evaluator import OutcomeEvaluator, SuccessContract


def test_success_contract_passes_only_with_required_output_and_evidence() -> None:
    evaluator = OutcomeEvaluator()
    contract = SuccessContract(
        required_output_fields=("answer",),
        min_answer_chars=8,
        require_evidence=True,
        allowed_effects=("read",),
    )

    result = evaluator.evaluate(
        contract,
        output={"answer": "年假政策以员工手册为准。"},
        evidence_count=1,
        effects=("read",),
    )

    assert result.outcome == "pass"
    assert result.passed is True


def test_success_contract_requests_revision_for_missing_evidence() -> None:
    result = OutcomeEvaluator().evaluate(
        SuccessContract(required_output_fields=("answer",), require_evidence=True),
        output={"answer": "有答案"},
        evidence_count=0,
        effects=("read",),
    )

    assert result.outcome == "revise"
    assert "EVIDENCE_REQUIRED" in result.issue_codes


def test_success_contract_fails_when_an_unapproved_effect_is_observed() -> None:
    result = OutcomeEvaluator().evaluate(
        SuccessContract(required_output_fields=("answer",), allowed_effects=("read",)),
        output={"answer": "已完成"},
        evidence_count=0,
        effects=("external",),
    )

    assert result.outcome == "fail"
    assert "EFFECT_NOT_ALLOWED" in result.issue_codes
