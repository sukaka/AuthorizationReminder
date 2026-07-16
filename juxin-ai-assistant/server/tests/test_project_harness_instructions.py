from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def test_project_harness_instructions_keep_safety_and_verification_boundaries():
    instructions = (PROJECT_ROOT / "AGENTS.md").read_text(encoding="utf-8")

    required_fragments = (
        "run_harness_release_gate.py",
        "run_ga_gate_local.py",
        "run_staging_preflight.py --mode local",
        "不访问 staging/生产",
        "不执行真实迁移",
        "不升级版本",
        "迁移候选只能使用",
        "统一状态契约、工具契约、租约/fencing",
    )
    for fragment in required_fragments:
        assert fragment in instructions
