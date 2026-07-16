"""The reconciliation runbook must remain executable and fail-closed."""

from pathlib import Path


RUNBOOK = Path(__file__).resolve().parents[2] / "docs" / "ops-runbook-6.0-7.0.md"


def test_reconciliation_sop_declares_machine_checkable_contract() -> None:
    text = RUNBOOK.read_text(encoding="utf-8")

    required_markers = (
        "### 3.1 直连与工具回执对账 SOP",
        "GET /api/ai/ops/tool-invocations/reconciliation",
        "POST /api/ai/ops/tool-invocations/{uuid}/reconcile",
        "GET /api/ai/ops/direct-actions/reconciliation",
        "POST /api/ai/ops/direct-actions/{uuid}/reconcile",
        "confirm_succeeded",
        "confirm_not_applied",
        "response_status",
        "response_payload",
        "新的 `Idempotency-Key`",
        "对账后再次查询快照",
    )

    missing = [marker for marker in required_markers if marker not in text]
    assert not missing, f"reconciliation SOP is incomplete: {missing}"


def test_reconciliation_sop_forbids_blind_retry_and_ambiguous_success() -> None:
    text = RUNBOOK.read_text(encoding="utf-8")

    assert "结果未知时禁止重发" in text
    assert "不能唯一确认" in text
    assert "reconciliation_required 数量必须下降" in text


def test_runbook_distinguishes_shortcut_rollout_from_release_canary() -> None:
    text = RUNBOOK.read_text(encoding="utf-8")

    required_markers = (
        "这只是日常操作入口，**不构成最终发布证据**",
        "internal(0%) → 1%(1%) → 5%(5%) → 20%(20%) → 50%(50%) → 100%(100%)",
        "每个阶段至少持续 48 小时",
        "完整 canary 窗口至少覆盖连续观测要求（默认 14 天）",
        "缺少内部或 1% 阶段时",
    )

    missing = [marker for marker in required_markers if marker not in text]
    assert not missing, f"release canary boundary is incomplete: {missing}"


def test_runbook_blocks_service_start_when_migration_graph_has_multiple_heads() -> None:
    text = RUNBOOK.read_text(encoding="utf-8")

    required_markers = (
        "python3 -m alembic heads",
        "必须只输出一个 revision",
        "输出多个 head",
        "不得通过指定任意一个 head 绕过门禁",
        "0045_agent_langgraph_checkpoints",
        "0051_professional_delivery",
        "保持 fail-closed",
    )

    missing = [marker for marker in required_markers if marker not in text]
    assert not missing, f"migration start guard is incomplete: {missing}"
