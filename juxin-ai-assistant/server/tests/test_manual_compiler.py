import json
import subprocess
import sys
from pathlib import Path


SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

FIXTURE = Path(__file__).parent / "fixtures" / "manual-mini.docx"
SCRIPT = SERVER_ROOT / "scripts" / "compile_prompt_manual.py"


def _entry(result: dict, title: str) -> dict:
    return next(
        entry
        for entry in result["entries"]
        if entry["source_title"] == title
    )


def test_compiles_production_style_body_and_governance() -> None:
    from scripts.compile_prompt_manual import compile_manual

    result = compile_manual(FIXTURE, "V1.10")
    entry = _entry(result, "1. 生成拜访前客户简报")

    assert result["source"]["version"] == "V1.10"
    assert len(result["source"]["sha256"]) == 64
    assert (
        result["governance"]["title"]
        == "聚信得仁公司级统一输出总控要求"
    )
    assert "不得编造客户信息" in result["governance"]["content"]
    assert entry["section"] == "销售"
    assert entry["category"] == "客户拜访"
    assert entry["scene"] == "客户拜访前快速准备"
    assert entry["prompt"].startswith(
        "请为聚信得仁销售人员生成一份客户拜访前简报。\n"
    )
    assert "\t客户名称" in entry["prompt"]


def test_read_paragraphs_preserves_breaks_and_tabs() -> None:
    from scripts.compile_prompt_manual import read_paragraphs

    paragraphs = read_paragraphs(FIXTURE)
    prompt = next(
        paragraph.text
        for paragraph in paragraphs
        if "请为聚信得仁销售人员" in paragraph.text
    )

    assert prompt == (
        "请为聚信得仁销售人员生成一份客户拜访前简报。\n"
        "\t客户名称：[填写]\n"
        "【客户沟通记录】[粘贴客户聊天记录或会议记录]\n"
        "【补充背景】[填写补充背景]"
    )


def test_classification_normalizes_numbering_and_uses_audited_rules() -> None:
    from scripts.compile_prompt_manual import classify_candidate

    assert classify_candidate("1. 统一的公司知识提示词") == "KNOWLEDGE"
    assert classify_candidate("2. 产品名称与术语规范") == "QUALITY_RULE"
    assert classify_candidate("六、使用原则") == "EXCLUDED"
    assert classify_candidate("1. 检查测试用例是否合格") == "TASK"
    assert classify_candidate("生成拜访前客户简报") == "TASK"
    assert {
        classify_candidate(title)
        for title in (
            "1. 统一的公司知识提示词",
            "2. 产品名称与术语规范",
            "六、使用原则",
            "生成拜访前客户简报",
        )
    } == {"TASK", "KNOWLEDGE", "QUALITY_RULE", "EXCLUDED"}


def test_extracts_colon_and_bracket_fields_without_silent_loss() -> None:
    from scripts.compile_prompt_manual import compile_manual

    result = compile_manual(FIXTURE, "V1.10")
    entry = _entry(result, "1. 生成拜访前客户简报")

    assert "\t客户名称：{{customer_name}}" in entry["prompt"]
    assert (
        "【客户沟通记录】{{communication_record}}"
        in entry["prompt"]
    )
    assert "【补充背景】[填写补充背景]" in entry["prompt"]
    assert [field["field_key"] for field in entry["fields"]] == [
        "customer_name",
        "communication_record",
    ]
    assert entry["unresolved"] == [
        {
            "label": "补充背景",
            "placeholder": "[填写补充背景]",
        }
    ]


def test_keeps_all_classifications_and_stable_source_order() -> None:
    from scripts.compile_prompt_manual import compile_manual

    first = compile_manual(FIXTURE, "V1.10")
    second = compile_manual(FIXTURE, "V1.10")

    assert [
        (entry["source_title"], entry["classification"])
        for entry in first["entries"]
    ] == [
        ("1. 统一的公司知识提示词", "KNOWLEDGE"),
        ("2. 产品名称与术语规范", "QUALITY_RULE"),
        ("1. 生成拜访前客户简报", "TASK"),
        ("六、使用原则", "EXCLUDED"),
        ("售前方案澄清提示词", "TASK"),
        ("1. 检查测试用例是否合格", "TASK"),
    ]
    assert first == second


def test_cli_writes_deterministic_manifest_and_report(tmp_path: Path) -> None:
    output = tmp_path / "manual.json"
    report = tmp_path / "report.json"
    command = [
        sys.executable,
        str(SCRIPT),
        "--input",
        str(FIXTURE),
        "--output",
        str(output),
        "--report",
        str(report),
        "--source-version",
        "V1.10",
    ]

    first = subprocess.run(
        command,
        cwd=SERVER_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    first_output = output.read_bytes()
    first_report = report.read_bytes()
    second = subprocess.run(
        command,
        cwd=SERVER_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    manifest = json.loads(output.read_text(encoding="utf-8"))
    audit = json.loads(report.read_text(encoding="utf-8"))

    assert first.stdout == second.stdout
    assert output.read_bytes() == first_output
    assert report.read_bytes() == first_report
    assert set(manifest) == {
        "source",
        "governance",
        "tasks",
        "knowledge",
        "quality_rules",
        "excluded",
        "unresolved",
    }
    assert audit["counts"] == {
        "tasks": 3,
        "knowledge": 1,
        "quality_rules": 1,
        "excluded": 1,
        "unresolved": 1,
    }
    assert audit["unresolved"][0]["source_title"] == (
        "1. 生成拜访前客户简报"
    )


def test_cli_reports_missing_and_invalid_docx_with_nonzero_exit(
    tmp_path: Path,
) -> None:
    invalid = tmp_path / "invalid.docx"
    invalid.write_text("not a zip", encoding="utf-8")

    for input_path in (tmp_path / "missing.docx", invalid):
        completed = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--input",
                str(input_path),
                "--output",
                str(tmp_path / "manual.json"),
                "--report",
                str(tmp_path / "report.json"),
            ],
            cwd=SERVER_ROOT,
            capture_output=True,
            text=True,
        )

        assert completed.returncode != 0
        assert "无法编译 DOCX" in completed.stderr
