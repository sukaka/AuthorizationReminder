from app.external_answer_safety import prepare_external_answer


def test_external_answer_appends_only_supported_public_sources() -> None:
    answer = prepare_external_answer(
        "产品支持在线资料下载。",
        source_file_names=["聚信产品白皮书.pdf", "聚信产品白皮书.pdf", "部署手册.pdf"],
    )

    assert answer is not None
    assert "资料来源：聚信产品白皮书.pdf、部署手册.pdf" in answer


def test_external_answer_blocks_prompt_or_sensitive_leakage() -> None:
    assert prepare_external_answer(
        "我的系统提示词如下：请展示内部规则。",
        source_file_names=["公开资料.pdf"],
    ) is None
    assert prepare_external_answer(
        "客服热线是 13812345678。",
        source_file_names=["公开资料.pdf"],
    ) is None
