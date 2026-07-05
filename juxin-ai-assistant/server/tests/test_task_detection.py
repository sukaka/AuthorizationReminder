from app.task_detection import analyze_task_mode


def test_task_detection_maps_role_modes_to_specific_task_types() -> None:
    assert analyze_task_mode("跟进客户需求", "sales")["task_type"] == "sales_followup"
    assert analyze_task_mode("写一份售前方案", "presales")["task_type"] == "presales_solution"
    assert analyze_task_mode("整理测试用例", "software_test")["task_type"] == "software_test"
    assert analyze_task_mode("写授权渗透测试计划", "pentest")["task_type"] == "pentest"


def test_task_detection_maps_web_and_word_tasks() -> None:
    assert analyze_task_mode("查一下最新 CVE-2026-12345 信息", "normal")["task_type"] == "web_search"
    assert analyze_task_mode("采集 https://example.com 这个网页", "normal")["task_type"] == "web_capture"
    assert analyze_task_mode("把当前回答导出 Word", "normal")["task_type"] == "word_export"


def test_task_detection_maps_codex_prompt_and_ui_design_tasks() -> None:
    assert analyze_task_mode("帮我写一个 Codex 提示词，让它按步骤审查代码", "normal")["task_type"] == "codex_prompt"
    assert analyze_task_mode("帮我看看这个聊天窗口 UI 怎么优化", "normal")["task_type"] == "ui_design"
