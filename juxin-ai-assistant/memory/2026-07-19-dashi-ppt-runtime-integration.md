# 2026-07-19 Dashi PPT 运行时接入记忆

## 当前状态

- 用户已明确要求：Dashi PPT Skill 需要能够直接生成 PPT，而不是只输出 Markdown/HTML 说明。
- 上游仓库的 PPTX/PDF 导出组件包含专有目录 `project/packages/html-deck-to-pptx`；其许可证允许作为 Dashi PPT Skill 的集成组件使用，但禁止单独提取、复制、再分发或用于其他软件/产品/服务。
- 采用独立上游 Skill 运行时适配器：聚信服务只传递受控的结构化演示稿计划，调用固定的上游导出脚本，并把产物放在 `export_storage_dir/dashi-ppt/<user>/<run>`。不把专有目录复制进聚信仓库。

## 安全决策

- 未配置 `DASHI_PPT_RUNTIME_ROOT` 时 fail-closed，返回“运行时未配置”，不生成假下载文件。
- 不接受用户任意 shell 命令、任意 URL 或任意输出路径；所有路径必须位于配置的运行时/导出根目录内。
- 下载必须校验 `SkillRunLog.user_id`、skill id 和格式，避免跨用户读取文件。

## 待办

- 完成后端适配器、SkillRunner 接入、下载路由、前端下载入口和测试。
- 真实运行时路径、Node/Playwright 依赖由部署环境配置，不写入仓库或日志；部署时保留上游 Skill 与其许可证文件的完整集成边界。
