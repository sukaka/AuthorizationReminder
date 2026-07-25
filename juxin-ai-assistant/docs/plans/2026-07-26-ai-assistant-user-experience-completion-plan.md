# 聚信 AI 助手使用体验补全计划

## 目标

把 2026-07-26 代码审计中确认的缺陷和高价值能力全部落地，使普通用户只需要提出问题或上传资料，系统能够自动选择能力、执行任务、恢复进度并交付可编辑成果。

## 范围

### 第一阶段：用户可见缺陷与基础体验

- 修复失败任务“继续普通回答”按钮无动作。
- Skill 不再构造虚假附件；需要附件时必须由用户选择真实文件。
- 项目成果、个人会话、知识资料和成员不再要求手工粘贴 UUID，改为可搜索选择。
- 普通用户界面隐藏 Run ID、会话 UUID 等内部标识；管理员诊断页保留。
- 修正 `6.0` 与当前产品版本混用的文案。
- 页面支持可复制、刷新可恢复的 URL，并补齐手机和平板布局。

候选文件：

- `apps/desktop/src/components/TaskProgressTimeline.tsx`
- `apps/desktop/src/pages/ChatPage.tsx`
- `apps/desktop/src/pages/SkillsPage.tsx`
- `apps/desktop/src/components/ProjectWorkspaceExtendedPanel.tsx`
- `apps/desktop/src/components/ChatRunContext.tsx`
- `apps/desktop/src/pages/TasksPage.tsx`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/styles/tokens.css`
- 对应 `apps/desktop/tests/*.test.tsx`

### 第二阶段：自动化闭环

- 聊天自动选择资料、Skill、前台/后台执行方式。
- PPT、长报告默认进入后台；短问答保持前台流式输出。
- 任务完成、失败、需要处理时统一通知，并可从链接恢复到具体任务或成果。
- 上传资料后自动分类、去重、版本识别，并允许一键转成果或加入项目。

### 第三阶段：底层稳定性

- 统一聊天 Run、后台任务和专业任务的状态、失败原因、重试和取消契约。
- 统一 Skill 的输入、附件、进度、产物和失败契约。
- 建立持久化任务事件流、租约/fencing、多 Worker 恢复和副作用幂等验证。
- Word、PPT、PDF、报告统一进入成果与版本契约。

### 第四阶段：高价值能力

- 深度研究：可编辑研究计划、来源范围、过程指令、引用和不确定性。
- 自然语言定时任务：创建、预览、暂停、恢复、历史执行和通知。
- 知识质量助手：重复、过期、解析失败、版本冲突、引用缺口和来源解释。
- 企业连接器优先只读；所有写操作必须明确确认并留下审计记录。

## 验收标准

- 普通用户界面需要手工输入 UUID 的入口为 0。
- 缺少真实附件时 Skill 启动次数为 0。
- 页面刷新、重新登录和 Worker 重启后丢失任务数为 0。
- 100 次恢复演练产生重复外部副作用数为 0。
- 任务状态展示延迟不超过 3 秒，完成通知不超过 5 秒。
- 成果导出后可打开率不低于 99%，引用有效率不低于 98%。
- 上传资料到可交付成果不超过 3 次操作（不含输入内容）。
- 320、375、768 像素宽度无页面级横向滚动，核心功能不被隐藏。
- URL 能恢复到指定会话、任务、成果和成果版本。
- 1000 条会话或任务可搜索，首屏 P95 小于 1 秒，输入响应小于 100 毫秒。

## 验证命令

桌面端：

```bash
cd apps/desktop
npm test -- --reporter=dot
npm run typecheck
npm run build
npm run test:e2e
```

后端：

```bash
cd server
python3 -m pytest -q tests --ignore=tests/test_migrations.py -ra
python3 scripts/run_harness_release_gate.py
python3 scripts/run_ga_gate_local.py --json
python3 scripts/run_staging_preflight.py --mode local --json
```

版本与差异：

```bash
git diff --check
```

## 风险与边界

- 保留当前工作树中与软著材料和 SCA 相关的未提交内容，不纳入本次提交。
- 不重写现有系统；优先复用已有 Run 状态机、任务租约、专业成果和知识治理能力。
- 不实现多人同时编辑；继续使用单编辑者锁和明确占用提示。
- 连接器凭据只通过环境变量或安全配置提供，不进入前台、数据库、日志或仓库。
