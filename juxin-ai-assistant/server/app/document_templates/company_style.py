from __future__ import annotations

FINAL_REVIEW_SECTIONS = (
    "待确认事项",
    "需人工复核事项",
    "不建议直接对外发送的内容",
    "可以直接落地执行的下一步动作",
)

COMPANY_REQUIRED_SECTIONS = (
    "基本信息",
    "背景说明",
    "目标与范围",
    "主要内容",
    "执行步骤或工作安排",
    "表格清单或结果统计",
    "风险与注意事项",
    "需确认事项",
    "交付物或附件",
    "结论与下一步计划",
)

FACT_RISK_CONTROL_ITEMS = (
    ("已知事实", "根据当前信息，建议进一步确认。"),
    ("合理判断", "根据当前信息，建议进一步确认。"),
    ("风险提醒", "涉及价格、合同、招投标、开票、回款、劳动关系、法律责任、测试结论、安全风险、交付周期、验收结论和对外承诺等内容，需人工复核。"),
)

COMPANY_WORD_STYLE = {
    "page": {
        "top_margin_cm": 2.5,
        "bottom_margin_cm": 2.5,
        "left_margin_cm": 2.8,
        "right_margin_cm": 2.8,
        "header_distance_cm": 1.3,
        "footer_distance_cm": 1.3,
    },
    "font": {
        "body": "宋体",
        "heading": "黑体",
    },
    "brand": {
        "name": "聚信得仁",
        "company": "北京聚信得仁科技有限公司",
        "header_line_color": "C00000",
        "table_header_fill": "D9EAF7",
        "confidentiality": "内部资料 注意保密",
    },
    "required_sections": COMPANY_REQUIRED_SECTIONS,
    "final_review_sections": FINAL_REVIEW_SECTIONS,
}
