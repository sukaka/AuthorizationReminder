# 2026-07-16 资料库外部访问与原文件外发控制

## 用户目标

公众号、小程序接入资料库后，部分文档不能提供给外部用户。参考方案要求把“AI 可检索回答”和“发送原文件”拆成两层，并对外部渠道默认拒绝。

用户随后改为：开始实现，但不提交、不推送、不升级版本号；等 AI 助手 5.0 完成后再发布该功能。

## 当前代码事实

- 项目：`/Users/zhanglei/Documents/codex-new/juxin-ai-assistant`
- 当前分支：`codex/ai-assistant-5.0`
- `VERSION` 当前为 `3.0.0`。
- 工作区已有大量用户未提交修改，相关文件也有重叠；必须保留这些修改并只暂存本功能对应的补丁。
- `KnowledgeFile.external_public` 已存在于当前工作区，默认 `false`。
- `search_knowledge_chunks(..., external_public_only=True)` 会在 SQL 检索前过滤外部不可访问文档。
- `wechat_external_routes.py` 的问答只复用 `external_public`，资料列表、下载令牌和最终下载同时要求 `external_download_allowed`。
- 桌面端 `KnowledgePage.tsx` 已暴露两个联动设置；API 类型 `KnowledgeFilePayload` 和元数据更新请求已包含两个字段。
- 当前迁移链已新增 `0064_knowledge_external_download_control`；工作区仍包含大量 5.0 未提交改动。

## 已定方案

- 保留 `external_public` 作为“允许外部问答”。
- 新增 `external_download_allowed` 作为“允许外部发送原文件”。
- 新字段默认 `false`，历史外部公开文档升级后也默认禁止下载。
- 下载要求两项都为真；关闭父权限时自动关闭下载。
- 只允许管理员设置，且只能对已审核、READY、RAG 开启的正式知识开放。
- 桌面端资料编辑区提供两个联动开关和状态标识。

## 已实现与验证

- 后端新增 `external_download_allowed` 字段、迁移、管理员接口校验和生命周期撤销逻辑。
- 公众号/小程序问答只检索 `external_public=true`；文件列表、令牌签发和最终下载还要求 `external_download_allowed=true`。
- 桌面资料库增加两个联动开关和状态标识；外部问答与原文件外发可独立控制。
- 目标后端测试、迁移测试、目标前端测试和 TypeScript 类型检查已通过；全量后端仍有 5 个既有非本功能失败，已单独记录。

## 下一步

等待 AI 助手 5.0 完成并形成稳定基线后，重新审阅本功能差异，只暂存本功能变更，按版本规则确定发布版本（若基线为 `5.0.x`，功能优化为 `5.1.0`），再由用户明确后提交和推送。
