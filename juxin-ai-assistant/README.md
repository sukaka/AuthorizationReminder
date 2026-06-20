# 聚信 AI 助手桌面端

聚信 AI 助手面向公司员工提供八类业务助手。统一登录、任务目录、Prompt、历史和反馈由公司服务管理；模型连接和 API Key 只保存在员工当前设备。

## 使用边界

- 生成结果是辅助材料，必须由员工复核后再发送、归档或用于业务决策。
- 浏览器版可以查看工作台、助手目录和个人历史，但不能调用本地模型生成内容。
- 桌面端通过 Tauri 调用当前设备上的 OpenAI 兼容模型。模型 API Key 进入系统钥匙串，不发送给 FastAPI、统一登录或 Prompt Center。
- 服务端只向桌面端下发与供应商无关的 messages、temperature 和安全提示，不接收模型 Base URL 或 API Key。

## 连接 OpenAI 兼容模型

1. 打开“个人模型”。
2. 填写名称、HTTPS Base URL（本机服务可使用 loopback HTTP）、模型 ID 和超时时间。
3. 通过密码输入框写入 API Key。保存后页面只显示“已保存”，不会回显密钥。
4. 点击连接测试；成功后可设为默认模型。

支持常见的 OpenAI 兼容路径，例如 `https://model.example.com/v1`。桌面端固定请求 `chat/completions`，启用流式响应并拒绝重定向、公共明文 HTTP 和带用户名密码的 URL。

## 敏感信息确认

提交任务时，服务端会检测手机号、邮箱、证件号等敏感信息。发现风险后只返回脱敏预览和当前输入的确认摘要：

- 弹窗不会展示敏感原文；
- 必须点击“确认并继续”才会调用本地模型；
- 修改任何输入后旧摘要失效，必须重新确认；
- 确认只适用于本次输入和本次生成。

## 历史、反馈与删除

- 历史列表只加载任务名、时间、状态、模型名等元数据；选择记录后才解密正文。
- 只能查看、反馈和删除自己的生成记录。
- 删除会清除输入、输出和知识引用正文，并保留不可恢复的审计墓碑。
- “重新生成”创建关联的新记录，并读取任务当前已发布的 Prompt。
- 支持七类反馈；“其他”必须填写补充说明。

## 设备草稿与待同步

- 草稿键按 `draft:<sso_user_id>:<task_uuid>` 隔离，七天后自动过期。
- 草稿和待同步输出使用设备随机密钥加密；密钥存于系统钥匙串固定账户 `result-sync-key`。
- 本地模型已完成但服务端暂时不可用时，结果进入加密待同步队列。
- 启动工作台或网络恢复时自动重试，采用有上限的指数退避。
- 草稿和队列不使用浏览器 `localStorage`，也不包含模型 API Key。

## 开发与验证

```bash
# 后端
cd juxin-ai-assistant/server
python3 -m pytest tests -q

# 桌面前端
cd ../apps/desktop
npm test
npm run build
npm run test:e2e

# Tauri
cargo test --manifest-path src-tauri/Cargo.toml

# 仓库一键验收
cd ../../../
bash scripts/tests/ai-assistant.sh
```

Playwright 员工闭环使用测试限定的 Tauri bridge 模拟本地模型进程，覆盖八类助手、搜索收藏、设备草稿、敏感确认、流式生成、同步、历史、复制、重新生成、反馈和删除，并验证测试模型密钥不进入任何 HTTP 请求。
