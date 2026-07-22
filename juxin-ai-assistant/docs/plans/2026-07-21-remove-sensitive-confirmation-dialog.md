# 移除敏感信息确认弹窗

## 目标

- 聊天和专业任务发送内容时不再显示“检测到敏感信息”确认弹窗。
- 包含手机号、邮箱或账号类文字的内容直接进入既有生成流程。
- 保留日志脱敏、密钥不进入长期记忆等后台安全能力。

## 范围

- 删除桌面端聊天页、专业任务页的弹窗状态和二次提交逻辑。
- 服务端聊天准备和专业任务准备不再返回敏感信息确认阻断。
- 保留旧请求中的 `sensitive_confirmation_digest` 字段兼容性，避免旧客户端请求失败。
- 更新前后端回归测试，验证疑似敏感内容只提交一次且不会弹窗。

## 验证

- `python3 -m pytest -q tests/test_chat_api.py tests/test_generation_flow.py -ra`
- `npm test -- --run tests/chat-page.test.tsx tests/task-run.test.tsx tests/employee-flow.test.tsx`
- `npm run typecheck`
- `git diff --check`

## 结果

- 已移除桌面端聊天页和专业任务页的敏感信息确认弹窗及二次提交逻辑。
- 服务端聊天准备与专业任务准备不再以 `SENSITIVE_CONFIRMATION_REQUIRED` 阻断请求；旧客户端携带的确认摘要字段仍可被兼容接收。
- 已保留日志脱敏、密钥保护和长期记忆敏感信息保护。
- 验证通过：后端定向测试 63 项，桌面端定向测试 74 项，桌面端类型检查通过，差异格式检查通过。
- 本次仅完成修复与验证，未升级版本、未提交、未推送。
