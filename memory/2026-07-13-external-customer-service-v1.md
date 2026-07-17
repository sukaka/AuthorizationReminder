# 外部客户智能客服 V1 实施记忆

日期：2026-07-13

## 目标

为公众号 H5 与企业微信客服提供外部客户问答、公开资料下载、无依据转人工，以及跨渠道每日问题 Top 20。

## 本轮已完成

- 新增方案：`juxin-ai-assistant/docs/plans/2026-07-13-external-customer-service-v1.md`。
- 新增加密的统一外部问题事件和外部热点报表模型，迁移为 `0039_external_customer_question_reports`。
- 新增 `server/app/external_question_events.py`，支持幂等记录事件、按公众号/企业微信客服/全渠道聚类生成 Top 20。
- 新增聚类测试 `server/tests/test_external_hot_questions.py`，已通过。

## 待继续

1. 将公众号 H5 的实际提问结果写入统一事件。
2. 在每日调度任务生成公众号、企业微信客服和全渠道的外部 Top 20。
3. 提供管理员读取外部热点报表的接口与测试。
4. 实施企业微信客服回调、知识库回答、公开资料下载和人工转接。
5. 更新迁移图测试并跑相关测试集。

## 约束

- 外部问题明文不得落库；统一事件与报表中的问题均使用 `ContentCipher` 加密。
- 公众号配额保持每小时 15 次、自然日 30 次。
- 仅检索 `external_public=True` 的已审核正式知识库资料。
- 工作区存在大量既有未提交改动，禁止清理、回退或覆盖无关文件。
