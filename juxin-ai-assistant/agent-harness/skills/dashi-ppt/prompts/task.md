请根据用户问题和可选资料，生成 Dashi PPT 制作计划。

先提炼：

- `title`：一句话标题。
- `goal`：希望听众在演示后理解或采取什么行动。
- `audience`：听众；未知时使用“内部业务团队”。
- `slide_count`：未指定时使用 8–10 页。
- `theme`：未指定时选择克制、易读的企业风格。
- `sources`：用户附件、公司知识库或个人资料中的可追溯来源。

输出页级大纲，每页包含 `index`、`title`、`purpose`、`key_points` 和 `visual_need`。生成 HTML 编辑目标后，默认调用已配置的 Dashi 运行时直接生成 PPTX；用户指定 PDF 或多种格式时按请求生成。只有运行时未配置或导出失败时，才将对应导出状态设为 `blocked`，并说明实际错误。
