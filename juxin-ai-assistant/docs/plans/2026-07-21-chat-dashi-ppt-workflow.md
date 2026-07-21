# 聊天内大师 PPT 生成与调整接入

## 目标

用户只在普通聊天中描述要制作或修改的 PPT，系统自动路由到已登记的 `dashi-ppt` Skill，在服务器运行 Dashi PPT 运行时及其 `html-deck-to-pptx` 导出组件，并把可编辑 HTML 与真实 PPTX 文件返回到当前聊天。

## 范围

- 识别明确的 PPT 生成与当前会话上一版 PPT 调整意图，不要求用户手动选择 Skill。
- 在聊天规划阶段约束模型输出完整演示稿结构，避免回答“不能生成 PPTX”。
- 通过统一 `SkillRunner` 执行 `dashi-ppt`，保留 Skill 运行状态、工具记录、错误和恢复语义。
- 将聊天答案转换为受校验的 Dashi `goal_spec`，在服务器生成 HTML 与 PPTX。
- 调整请求读取同一用户、同一聊天会话最近一次成功的 Dashi 运行计划，生成新版本，不覆盖旧版本。
- 聊天附件支持 HTML；HTML 可下载后在浏览器中打开并继续编辑，PPTX 提供下载入口。

## 非目标

- 不把上游专有导出组件复制进本仓库，不改变其许可证或独立分发方式。
- 不在本次修改中部署服务器、迁移数据库、升级版本号、提交或推送 Git。
- 不实现多人同时编辑；每次聊天调整产生独立的新 Skill 运行和新文件版本。

## 验收标准

1. “帮我做一份……PPT”会自动调用 `dashi-ppt`，返回 HTML 与 PPTX 两个真实产物。
2. 模型收到明确的 PPT 生成约束，不再输出“只能提供大纲、不能生成 pptx”。
3. “把刚才的 PPT 改成……”能找到当前会话上一版成功运行计划，并创建新版本；其他用户或其他会话的计划不可见。
4. 运行时未配置、渲染失败或导出失败时返回明确错误，不伪造下载文件，失败记录保留在统一 Skill 运行日志中。
5. 非 PPT 聊天和现有普通文档生成行为保持不变。

## 实施步骤

1. 先增加意图识别、完整演示稿计划转换、上一版隔离和聊天产物映射测试。
2. 增加聊天 PPT 编排模块，并在聊天准备阶段注入服务器可生成文件的系统约束。
3. 在聊天完成阶段调用 `SkillRunner`，把 HTML/PPTX 产物写入消息附件。
4. 更新后端/前端附件类型，并明确提示 HTML 下载后可继续编辑。
5. 运行针对性后端测试、前端类型检查和差异检查，记录结果与剩余部署项。

## 验证命令

```bash
PYTHONPATH=server python3 -m pytest -q server/tests/test_chat_dashi_ppt.py server/tests/test_chat_api.py server/tests/test_dashi_ppt_runtime.py server/tests/test_skills.py
cd apps/desktop && npm run typecheck
git diff --check
```

## 实施结果

- 普通聊天已经支持自动识别 PPT 创建与调整意图，无需选择助手或手动运行 Skill。
- 创建请求会调用服务器上的 `dashi-ppt`，通过其完整运行时及 `html-deck-to-pptx` 生成真实 HTML/PPTX。
- “把第二页改成风险分析”等连续请求会读取当前用户、当前聊天最近一次成功计划，生成新版本并保留旧文件。
- 自动生成的内容页使用不重复版式；单次生成最多 10 页，避免长篇内容触发版式重复限制。
- 后端相关测试共 54 项通过，桌面端类型检查和 Git 差异检查通过。
- 已用真实 Dashi 运行时完成 10 页 HTML/PPTX 无界面导出；PPTX 压缩包完整性检查通过，包含 10 个页面文件。

## 剩余部署项

本次没有操作远程预发布服务器。上线验证前需要在服务器安装锁定的 Dashi 运行时、挂载运行时目录、重建 API 服务，然后使用真实登录账号在聊天中完成一次“生成 PPT → 修改第二页 → 下载两版 PPTX”的冒烟测试。

## 部署边界

服务器必须把 `DASHI_PPT_RUNTIME_ROOT` 指向完整、未拆分的 Dashi PPT Skill `project` 目录，并安装该目录声明的依赖。配置缺失时聊天链路必须失败关闭，不能退回伪造文件或仅返回大纲。

## 预发布构建 401 修复

### 问题

预发布服务器构建 `ai-assistant-api` 和 `ai-assistant-db-init` 时，默认拉取需要认证的腾讯云 Python 基础镜像，未登录对应私有仓库会返回 `401 Unauthorized`，导致 Dashi PPT 运行时无法随 API 镜像完成部署。

### 最小修复

1. 根 `docker-compose.yml` 的 Python 基础镜像默认值改为公开的 `python:3.12-slim`。
2. `juxin-ai-assistant/server/Dockerfile` 保持相同公开默认值，确保直接构建也不依赖腾讯云登录。
3. 保留 `PYTHON_BASE_IMAGE` 覆盖能力；确需使用私有镜像时由部署环境显式设置并先完成仓库登录。
4. 增加配置回归脚本，验证 Compose 和 Dockerfile 的公开默认值及显式覆盖契约。

### 验证命令

```bash
bash scripts/tests/ai-assistant-public-python-base-image.sh
docker compose -f docker-compose.yml -f juxin-ai-assistant/docker-compose.ai-assistant-dashi-ppt.yml config --quiet
git diff --check
```

### 验证结果

- 新增的基础镜像回归检查通过。
- Dashi PPT 叠加配置通过 `docker compose config --quiet` 校验；本地未注入部署密钥时只产生预期的环境变量警告。
- Dockerfile 镜像源一致性检查通过。
- 已联网确认 `python:3.12-slim` 同时提供 Linux amd64 与 arm64 镜像。
- Git 差异格式检查通过。
