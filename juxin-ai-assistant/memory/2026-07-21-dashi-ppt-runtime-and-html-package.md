# 2026-07-21 Dashi PPT 运行时与 HTML 工程包

## 用户目标

让聚信 AI 助手在 Docker API 容器中真实执行 Dashi PPT，交付真正的 PPTX 和可离线编辑的完整 HTML 工程包；不再交付缺少资源的单个 HTML 文件。

## 已实现

- Docker 覆盖编排将 Dashi `project` 挂载为 `/opt/dashi-ppt-runtime`，仅开放其 `output/` 子目录给导出过程写入临时 HTTPS 预览配置。
- 导出文件保存到持久卷 `/data/ai-assistant/dashi-ppt-exports`，避免 API 重建后丢失。
- HTML 格式新任务统一生成 `presentation-html.zip`，根目录包含 `index.html` 和完整 `assets/` 资源；旧任务仍可读取原来的 `ppt/index.html`。
- 下载接口按新工程包返回 `application/zip` 与 `presentation-html.zip`；前端改为提示“解压后打开 index.html（可编辑）· HTML 工程包”。
- Dashi goal spec 自动同步封面的 `chipCount`、`metaCount`，并限制标题、导语、要点文本长度，降低模板布局和导出失败风险。
- 安装脚本会创建运行时 `output/` 目录；部署文档说明必须在实际 Linux 服务器安装该服务器对应的 `node_modules`。

## 真实验证结果

- 在 Docker API 镜像内、Linux 版 Dashi 运行时挂载下实际生成了 5 页 PPT，产物包括 `presentation-html.zip` 和 `presentation.pptx`。
- ZIP 完整性检查通过；解压后包含 `index.html`、`assets/imported-theme-runtime.js` 及字体资源。
- `validate:goal-copy` 和 `validate:swiss` 均通过。
- 后端 Dashi 相关测试 11 项全部通过；桌面端类型检查和聊天页面测试 56 项全部通过。

## 尚待环境验收

- Codex 内置浏览器的安全策略禁止访问本地 `file://`，因此未能在该浏览器中执行离线打开步骤。部署服务器或本机需要解压工程包后以浏览器打开 `index.html`，重点核对最后一页无“该页渲染失败，内容已跳过”。
- 本地 Compose 的全量重启被现有 `.env` 缺少必填运行环境配置阻塞；不得用假值替代。服务器补齐其既有配置后，按部署文档先构建再启动 API 完成最终预发布验收。
