import json
import subprocess
import sys
from pathlib import Path


SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

FIXTURE = Path(__file__).parent / "fixtures" / "manual-mini.docx"
SCRIPT = SERVER_ROOT / "scripts" / "compile_prompt_manual.py"
CATALOG = SERVER_ROOT / "catalog" / "assistants.json"
V110_MANIFEST = SERVER_ROOT / "catalog" / "manual-v1.10.json"
V110_REPORT = SERVER_ROOT / "catalog" / "manual-v1.10-report.json"
PROMPT_VARIABLE_PATTERN = r"\{\{([a-z][a-z0-9_]*)\}\}"
NON_INPUT_COLON_LABEL_PATTERN = (
    r"^(?:要求|写作要求|回答原则|注意|请注意|请重点检查|重点检查|"
    r"请覆盖以下维度|请严格按照以下字段输出测试用例表|"
    r"请优先从软件产品功能角度设计测试|"
    r"安全测试不是本次主线，只需要适当补充|"
    r"安全能力只作为功能结果验证，例如|"
    r"填写执行测试前需要具备的条件，例如|"
    r"填写可使用的测试数据，例如|"
    r"至少覆盖以下异议|每个异议输出|表格格式如下|"
    r"请从以下角度检查|并补充覆盖以下业务要点|"
    r"然后补充覆盖以下业务要点|"
    r"如需表格，表格样式和字段规则遵循第三部分总控模块，"
    r"业务字段至少包括|请生成以下类型数据|"
    r"待办任务表字段包括|交接类别至少包括|"
    r"其中“测试内容”至少包括)$"
)


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


def _load_v110_artifacts() -> tuple[dict, dict, dict]:
    return (
        json.loads(V110_MANIFEST.read_text(encoding="utf-8")),
        json.loads(V110_REPORT.read_text(encoding="utf-8")),
        json.loads(CATALOG.read_text(encoding="utf-8")),
    )


def test_v110_reviewed_manifest_integrity() -> None:
    manifest, report, _ = _load_v110_artifacts()
    required_task_keys = {
        "assistant_code",
        "code",
        "name",
        "aliases",
        "merge_existing_code",
        "prompt_external_id",
        "document_type",
        "formal_document",
        "source_ref",
        "scene",
        "prompt",
        "fields",
    }
    required_field_keys = {
        "field_key",
        "label",
        "field_type",
        "required",
        "placeholder",
        "example",
        "options_json",
        "validation_json",
        "sort_order",
    }

    assert manifest["source"]["version"] == "V1.10"
    assert len(manifest["tasks"]) > 88
    assert manifest["unresolved"] == []
    assert report["unresolved"] == []
    for task in manifest["tasks"]:
        assert required_task_keys <= task.keys()
        assert task["prompt"].strip()
        assert task["source_ref"].startswith("V1.10｜")
        assert task["assistant_code"] in {
            "general",
            "sales",
            "presales",
            "delivery",
            "software-testing",
            "hr",
            "tender",
            "security",
            "documents",
            "training",
        }
        assert isinstance(task["formal_document"], bool)
        assert isinstance(task["aliases"], list)
        assert all(required_field_keys <= field.keys() for field in task["fields"])
        assert len({field["field_key"] for field in task["fields"]}) == len(
            task["fields"]
        )


def test_v110_ids_codes_and_merge_links_are_auditable() -> None:
    manifest, report, catalog = _load_v110_artifacts()
    catalog_tasks = {
        task["code"]: task
        for assistant in catalog["assistants"]
        for task in assistant["tasks"]
    }
    tasks = manifest["tasks"]
    ids = [task["prompt_external_id"] for task in tasks]
    codes = [task["code"] for task in tasks]
    new_ids = sorted(
        task["prompt_external_id"]
        for task in tasks
        if task["merge_existing_code"] is None
    )

    assert len(ids) == len(set(ids))
    assert len(codes) == len(set(codes))
    assert new_ids == list(range(1089, 1089 + len(new_ids)))
    for task in tasks:
        existing_code = task["merge_existing_code"]
        if existing_code is None:
            assert task["prompt_external_id"] >= 1089
            continue
        assert existing_code in catalog_tasks
        assert (
            task["prompt_external_id"]
            == catalog_tasks[existing_code]["prompt_external_id"]
        )
        assert any(
            decision["code"] == task["code"]
            and decision["existing_code"] == existing_code
            and decision["basis"] in {"EXACT_NAME", "APPROVED_ALIAS"}
            for decision in report["merged"]
        )


def test_v110_classification_partition_and_review_counts() -> None:
    manifest, report, _ = _load_v110_artifacts()
    partition_names = ("tasks", "knowledge", "quality_rules", "excluded")
    source_refs = [
        item["source_ref"]
        for name in partition_names
        for item in manifest[name]
    ]

    assert len(source_refs) == len(set(source_refs))
    assert report["counts"]["tasks"] == len(manifest["tasks"])
    assert report["counts"]["merged"] == len(report["merged"])
    assert report["counts"]["new"] == len(report["new"])
    assert report["counts"]["knowledge"] == len(manifest["knowledge"])
    assert report["counts"]["quality_rules"] == len(
        manifest["quality_rules"]
    )
    assert report["counts"]["excluded"] == len(manifest["excluded"])
    assert report["counts"]["unresolved"] == 0
    assert report["counts"]["reviewed_unresolved_groups"] == 84
    assert report["counts"]["reviewed_unresolved_items"] == 525
    assert report["counts"]["total_review_decisions"] == len(
        report["review_decisions"]
    )
    assert report["counts"]["additional_unlabeled_fields"] == len(
        report["additional_field_decisions"]
    )
    assert report["review_decisions"]
    assert all(
        decision["replacements"] > 0
        for decision in report["review_decisions"]
        if decision["resolution"] == "FIELD"
    )
    assert all(
        decision["replacements"] > 0
        for decision in report["additional_field_decisions"]
    )
    assert {
        decision["classification"]
        for decision in report["classification_decisions"]
    } == {"TASK", "KNOWLEDGE", "QUALITY_RULE", "EXCLUDED"}
    for item in manifest["excluded"]:
        assert item["source_title"]
        assert item["classification"] == "EXCLUDED"
        assert item["reason"]


def test_v110_prompt_variables_match_complete_fields() -> None:
    import re

    manifest, _, _ = _load_v110_artifacts()
    for task in manifest["tasks"]:
        variables = set(re.findall(PROMPT_VARIABLE_PATTERN, task["prompt"]))
        field_keys = {field["field_key"] for field in task["fields"]}

        assert variables == field_keys
        assert re.findall(r"\[[^\]\n]+\]", task["prompt"]) == []
        for index, field in enumerate(task["fields"], start=1):
            assert field["sort_order"] == index * 10
            assert field["field_type"] in {"TEXT", "TEXTAREA", "SELECT"}
            assert isinstance(field["required"], bool)
            assert isinstance(field["options_json"], list)
            assert isinstance(field["validation_json"], dict)
            if field["field_type"] == "SELECT":
                assert field["options_json"]


def _blank_input_slots(prompt: str) -> list[str]:
    import re

    slots = []
    lines = prompt.splitlines()
    for index, line in enumerate(lines):
        stripped = line.strip().lstrip("-•*").strip()
        if "|" in stripped:
            cells = [cell.strip() for cell in stripped.strip("|").split("|")]
            if cells and not all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells):
                slots.extend(
                    f"表格空单元#{cell_index}"
                    for cell_index, cell in enumerate(cells, start=1)
                    if not cell
                )
        fill_block = re.fullmatch(r"【(?:请)?(?:填写|粘贴)([^】]+)】", stripped)
        if (
            fill_block is not None
            and (index == 0 or "{{" not in lines[index - 1])
        ):
            slots.append(fill_block.group(1).strip())
        match = re.fullmatch(r"([^：:{}]{1,40})[：:]\s*", stripped)
        if match is None:
            continue
        label = match.group(1).strip()
        if re.fullmatch(NON_INPUT_COLON_LABEL_PATTERN, label):
            continue
        if re.fullmatch(r"字段\d+", label):
            continue
        if re.match(
            r"^(?:请|以下|最后|同时|然后|每|可考虑|在第三部分|"
            r"问题需要|训练|回答结构|PPT建议|满分|方案应包括|"
            r"信息收集表|每套方案|改写要求|重点识别)",
            label,
        ):
            continue
        slots.append(label)
    return slots


def test_v110_has_no_silent_blank_input_slots() -> None:
    manifest, report, _ = _load_v110_artifacts()

    missing = {
        task["code"]: _blank_input_slots(task["prompt"])
        for task in manifest["tasks"]
        if _blank_input_slots(task["prompt"])
    }

    assert missing == {}
    assert report["counts"]["reviewed_blank_slots"] == len(
        report["blank_slot_decisions"]
    )
    assert report["counts"]["reviewed_blank_slots"] > 0
    assert all(
        decision["resolution"] == "FIELD"
        and decision["original_slot"].endswith(("：", ":"))
        and decision["field_key"]
        and decision["replacements"] > 0
        for decision in report["blank_slot_decisions"]
    )
    blank_audit_keys = {
        (
            decision["source_ref"],
            decision["original_slot"],
            decision["field_key"],
        )
        for decision in report["review_decisions"]
        if decision.get("review_origin") == "BLANK_SLOT"
    }
    assert blank_audit_keys == {
        (
            decision["source_ref"],
            decision["original_slot"],
            decision["field_key"],
        )
        for decision in report["blank_slot_decisions"]
    }


def test_v110_rejects_semantically_unequal_alias_merges() -> None:
    manifest, report, _ = _load_v110_artifacts()
    forbidden = {
        "security-service-plan",
        "project-proposal",
        "bid-error-check",
        "delivery-solution",
        "implementation-plan",
        "troubleshooting-report",
        "software-test-plan",
        "training-plan",
        "administrative-policy-optimization",
    }
    merged_codes = {
        task["merge_existing_code"]
        for task in manifest["tasks"]
        if task["merge_existing_code"] is not None
    }

    assert merged_codes.isdisjoint(forbidden)
    assert all(
        decision["equivalence"]["input"]
        and decision["equivalence"]["output"]
        and decision["equivalence"]["scene"]
        for decision in report["merged"]
    )


def test_v110_document_rules_cover_formal_and_informal_outputs() -> None:
    manifest, _, _ = _load_v110_artifacts()
    tasks = {task["code"]: task for task in manifest["tasks"]}
    cases = {
        "project-weekly-report": ("REPORT", True),
        "meeting-minutes": ("MINUTES", True),
        "v110-delivery-080": ("REPORT", True),
        "v110-presales-044": ("BID_DOCUMENT", True),
        "v110-delivery-085": ("CHECKLIST", True),
        "v110-sales-010": ("COMMUNICATION", False),
        "v110-sales-014": ("COMMUNICATION", False),
    }

    for code, expected in cases.items():
        task = tasks[code]
        assert (task["document_type"], task["formal_document"]) == expected


def test_v110_source_refs_and_static_json_are_deterministic() -> None:
    import hashlib

    manifest, report, _ = _load_v110_artifacts()

    for name in ("tasks", "knowledge", "quality_rules", "excluded"):
        for item in manifest[name]:
            parts = item["source_ref"].split("｜")
            assert parts[0] == "V1.10"
            assert len(parts) >= 4
            assert all(parts)
            assert "部分" in parts[1]
    assert report["artifact_sha256"]["manifest"] == hashlib.sha256(
        V110_MANIFEST.read_bytes()
    ).hexdigest()
    assert report["review_rules"]["merge"] == (
        "仅精确名称或报告中明确批准的别名允许合并；禁止隐式模糊匹配。"
    )
    assert report["review_rules"]["formal_document"]
    assert (
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True)
        + "\n"
        == V110_MANIFEST.read_text(encoding="utf-8")
    )
    assert (
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True)
        + "\n"
        == V110_REPORT.read_text(encoding="utf-8")
    )
