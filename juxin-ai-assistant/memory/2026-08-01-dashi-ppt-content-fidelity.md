# 2026-08-01 大师 PPT 内容一致性

## 目标

用户已授权修复聊天内大师 PPT 内容与原始需求跑题的问题，服务器实际模型为 DeepSeek；不修改版本号、提交或推送。

## 已确认原因

- `chat_ppt_workflow.py` 只要求宽松 Markdown，并截断专用提示里的原始需求。
- Markdown 解析失败时会静默生成“核心内容”和泛化导语。
- theme01 的 `_slide_points` 与若干 layout props 会补入“行动闭环、执行抓手”等无关话术。
- 流式模型路由对普通短请求限制 1536 tokens 且可关闭 thinking；PPT 应获得独立额度。

## 计划

1. 先写失败回归测试。
2. 收紧 PPT 输出结构和解析，拒绝不完整内容。
3. 移除默认业务话术，并为 PPT 提升模型路由。
4. 跑定向测试和静态检查，记录结果。

## 变更与验证

- 结构化输出改为 JSON 优先并兼容既有 Markdown；无有效页面时返回 `DASHI_PPT_CONTENT_INVALID`，不再创建通用兜底演示稿。
- theme01 与其他主题的填充器均不再注入“经营复盘”“行动计划”等与用户主题无关的文字。
- 大师 PPT 的流式与非流式模型请求均使用最高 4096 的输出额度，并允许模型正常推理。
- 定向回归：`python3 -m pytest tests/test_chat_dashi_ppt.py -q`（10 passed）；`python3 -m pytest tests/test_chat_api.py -q`（44 passed）。
