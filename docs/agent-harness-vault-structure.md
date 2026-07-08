# 聚信 AI 助手 Agent Harness Vault Structure

## 目的

`agent-harness/` 是聚信 AI 助手自己的 Agent 工作规约目录，用来描述 Agent 如何规划、执行、验证、复盘和治理。

它不是某个模型供应商的专属目录，也不保存密钥。

## 目录结构

```text
agent-harness/
  AGENTS.md
  settings.json
  agents/
    planner.md
    verifier.md
    replayer.md
  skills/
    knowledge.md
    task-run.md
    governance.md
    desktop.md
    quality.md
  tools/
    registry.json
  memory/
    progress.md
    risks.md
```

## 文件职责

1. `AGENTS.md`
   - 总入口。
   - 说明 Agent 工作顺序、上下文边界、工具边界和验收要求。

2. `settings.json`
   - 保存 Harness 策略。
   - 不保存密钥。
   - 不绑定模型供应商。

3. `agents/planner.md`
   - 负责拆任务、定步骤、列风险和验收标准。

4. `agents/verifier.md`
   - 负责检查输出是否可靠、合规、安全。

5. `agents/replayer.md`
   - 负责复盘一次运行的关键过程、失败原因和下一步。

6. `skills/*.md`
   - 描述可复用能力。
   - 每个 skill 只写适用场景、输入、输出、验收标准、禁止事项。

7. `tools/registry.json`
   - 登记工具概念。
   - 外部写操作默认关闭。
   - 不放密钥。

8. `memory/*.md`
   - 记录工程进度和风险。
   - 不记录敏感信息。

## 后续接入方向

1. 后端接入 Agent Run 数据。
2. 工具调用写审计记录。
3. Verifier 输出质量摘要。
4. Replayer 生成复盘摘要。
5. 知识库治理记录资料质量和引用情况。

## 边界

- 本目录只定义规约和治理结构。
- 不直接执行工具。
- 不保存用户密钥。
- 不替代数据库权限控制。
- 不把个人资料自动变成公司正式知识。
