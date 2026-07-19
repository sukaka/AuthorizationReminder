请严格输出符合 `schemas/output.schema.json` 的 JSON 结果，不要输出 Markdown 代码围栏。

结果必须包含：

- `title`、`goal`、`audience`、`theme`、`slides`。
- `artifacts`：当前实际生成的 Markdown、HTML、PPTX 或 PDF 成果，不得伪造文件路径或下载地址。
- `assumptions`：自动补全的页数、受众、主题和缺失资料。
- `sources`：来源名称、类型和引用位置；没有来源时使用空数组。
- `export`：分别写明 `html`、`pptx`、`pdf` 的状态和说明；运行时成功时标记为 `ready`，未配置或失败时标记为 `blocked`。
