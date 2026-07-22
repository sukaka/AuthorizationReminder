# Dashi PPT 运行时与 HTML 工程包修复计划

## 目标

- 让 API 容器以固定路径 `/opt/dashi-ppt-runtime` 使用已安装的 Dashi PPT project（其中包含 `node_modules`），并将生成结果持久化到独立的导出卷。
- 将 HTML 交付从单个 `presentation.html` 改为完整的 `presentation-html.zip`；压缩包根目录保留 `index.html` 与 `assets/`。
- 保持历史任务可下载原有 `ppt/index.html`，新生成任务统一产出 HTML 工程包与真实 PPTX。
- 在聊天生成的封面补齐 `chipCount`、`metaCount`，并收紧文本长度，避免上游布局校验或渲染失败。

## 实施范围

1. 后端运行时：生成后检查 HTML 工程资源并打包 ZIP；下载接口根据新旧产物返回正确文件名和 MIME。
2. 聊天工作流：补足封面计数字段，限制标题、导语、章节与要点长度。
3. 前端：将 HTML 文件说明改为“解压后打开 index.html（可编辑）· HTML 工程包”。
4. 部署：Dashi Compose 叠加文件挂载运行时并持久化导出目录。
5. 测试与验收：覆盖 ZIP、新旧兼容、下载头、封面字段和文本上限；使用实际 Dashi 运行时生成并校验 HTML/PPTX。

## 验证标准

- 新任务同时生成 `presentation-html.zip` 和 `presentation.pptx`。
- ZIP 的根目录含 `index.html`、`assets/imported-theme-runtime.js` 及被渲染页引用的资源。
- `validate:goal-copy` 与 `validate:swiss` 通过，且所有页面离线渲染正常。
- 后端、前端定向测试、类型检查和 Compose 配置检查通过。
