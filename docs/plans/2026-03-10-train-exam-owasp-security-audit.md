# Train-Exam OWASP Security Audit

**Date:** 2026-03-10

## Scope

- Target: `train-exam`
- Ranking baseline: OWASP Top 10 2021 (`A01` - `A10`)
- Method: static review + limited runtime spot checks
- Key files reviewed:
  - `train-exam/backend/src/index.js`
  - `train-exam/backend/src/db.js`
  - `train-exam/backend/package.json`
  - `train-exam/frontend/package.json`
  - `auth/index.js`
  - `docker-compose.yml`

## Runtime Basis

- Running services confirmed on 2026-03-10:
  - `auth` on `5180`
  - `train-exam-api` on `5188`
  - `web-train-exam` on `8087`
- Backend baseline:
  - `cd train-exam/backend && npm test`
  - Result: `6` test files, `18` tests passed
  - Note: bundled smoke test skipped its admin flow because current `admin` password could not be auto-resolved
- Runtime spot-check identities:
  - `editor`
  - `reviewer`
  - `auditor`
- Runtime limitation:
  - `admin` account was not available for login during this audit, so admin-only HTTP paths were assessed primarily by static evidence

## Executive Summary

本次审计发现的高优先级问题主要集中在四类：

1. 内建高权限账号仍可使用旧默认口令登录，`sysadmin / auditor / editor / reviewer` 已在运行态验证成功
2. `train-exam` 后端接受统一登录 Cookie，但未做 CSRF 防护，Cookie-only 的状态变更请求可以直接生效
3. 运行栈仍通过 `docker-compose.yml` 和容器环境变量加载硬编码密钥/数据库口令，且 OnlyOffice 密钥在多个系统间复用
4. 文档预览文件接口在鉴权链之外，只要拿到预览 token 就可以脱离登录态直接下载文档

## Findings By OWASP Top 10

### A01 Broken Access Control

#### Finding A01-1: 课程与资源默认对任意已登录 train-exam 用户开放读取

- Risk: Medium
- Confidence: High
- Impact:
  - 任何具备 `train-exam` 入口权限的账号都可读取课程列表、课程资源、文档预览配置、资源下载与流播放接口
  - 如果培训资料包含仅限部分部门或考试批次的内容，当前模型会造成横向可见
- Static evidence:
  - `train-exam/backend/src/index.js:434-492` 中 `canReadTrainExam = () => true`
  - `train-exam/backend/src/index.js:3965-3993` 课程列表只挂 `requireReader`
  - `train-exam/backend/src/index.js:4138-4148` 课程资源列表只挂 `requireReader`
  - `train-exam/backend/src/index.js:4577-4604`, `4606-4690`, `4819-4834` 文档预览、流播放、下载都只挂 `requireReader`
- Runtime evidence:
  - `editor` 账号成功请求 `GET /api/train-exam/resources/25/doc-preview-config`，返回 `200`
  - `editor` 账号成功请求 `GET /api/train-exam/resources/25/download`，返回 `200 application/pdf`
  - 资源 `25` 为 `admin` 创建的上传文档，说明这里不是“本人资源”模型
- Recommendation:
  - 如果课程/资源本应按人群、部门、班次或报名关系隔离，需要补课程可见性 ACL
  - 至少为 `courses/:id/resources`、`resources/:id/*`、`courses/:id/learning-path` 增加按课程授权校验
  - 如果产品明确要求“全员可见”，应在需求和审计文档中显式记录，避免误判为越权

#### Checked Item A01-2: 考试会话与成绩记录的对象级访问控制当前有效

- Static evidence:
  - `train-exam/backend/src/index.js:2816-2833` 的 `ensureExamSessionAccess` / `ensureResultAccess`
  - `train-exam/backend/src/index.js:6454-6587`, `7024-7538` 会话、成绩、证书相关路由均调用上述 helper
- Runtime evidence:
  - `editor` 访问 `GET /api/train-exam/results/17` 返回 `403`
  - `editor` 访问 `GET /api/train-exam/exam-sessions/18` 返回 `403`
  - `reviewer` 访问 `GET /api/train-exam/results/17` 返回 `403`
  - `auditor` 访问 `GET /api/train-exam/results/17` 和 `GET /api/train-exam/exam-sessions/18` 返回 `200`
- Conclusion:
  - `result/session` 的“本人可读 + admin/auditor 可审计读”逻辑与代码意图一致，未发现直接 IDOR

### A02 Cryptographic Failures

#### Finding A02-1: 运行栈仍依赖硬编码密钥、数据库口令和跨系统复用的文档密钥

- Risk: High
- Confidence: High
- Impact:
  - 一旦仓库、镜像、Compose 文件或容器环境泄露，会直接暴露数据库、JWT、配置加密、审计签名和文档服务密钥
  - OnlyOffice 密钥跨系统复用会扩大单点失陷后的横向影响面
- Static evidence:
  - `docker-compose.yml:1-8` MySQL root/app 口令直接写在编排文件中
  - `docker-compose.yml:59-64` `auth` 使用字面量 `AUTH_COOKIE_*`、`JWT_SECRET`、`CONFIG_SECRET_KEY`、`BUILTIN_ACCOUNT_DEFAULT_PASSWORD`
  - `docker-compose.yml:390-409` `train-exam-api` 使用字面量 `MYSQL_ADMIN_PASSWORD`、`FAQ_MYSQL_PASSWORD`、`AUDIT_SIGNING_KEY`、`DOC_EDITOR_JWT_SECRET`
  - `docker-compose.yml:429-435` `onlyoffice` 直接加载 `JWT_SECRET`
  - `train-exam/backend/src/index.js:41`, `79-81` 存在默认审计签名密钥与默认文档密钥回退值
  - `auth/index.js:16`, `32-56` `auth` 会校验弱密钥，但 `train-exam` 自身没有同等级别的启动期阻断
  - `README.md:88` 明确说明多个系统共享同一 OnlyOffice 密钥
- Runtime evidence:
  - 对运行中的 `auth` 与 `train-exam-api` 做容器环境检查，确认上述敏感变量当前确实已注入容器，而不是仅停留在源码默认值
- Recommendation:
  - 把所有敏感项迁移到 secret manager / `.env` / CI secret 注入，不再提交到仓库
  - 立刻轮换：JWT、CONFIG、AUDIT、OnlyOffice、MySQL root/app、FAQ 访问口令
  - 为 `train-exam` 增加与 `auth` 类似的“弱密钥启动失败”机制
  - 为不同系统分配独立文档密钥，避免 FAQ / Tender / Train Exam 共用一把钥匙

### A03 Injection

#### Checked Item A03-1: 本轮未发现高置信度的 SQL 注入或命令注入入口

- Checked items:
  - `train-exam/backend/src/db.js` 中数据库访问主要使用参数化查询
  - `train-exam/backend/src/index.js:1139` 的转码调用使用 `spawn(command, args)`，未见 shell 拼接执行
  - 上传文件名经过 `path.basename` 和白名单字符清洗
- Conclusion:
  - 当前没有发现可直接利用的 SQLi / command injection
  - 需要注意的是，资源读取路径 `sendFile/download` 没有像删除逻辑那样再次做 root 校验，但公开 API 目前也没有直接把任意路径写入 `storage_path` 的入口，因此这次未提升为独立 finding

### A04 Insecure Design

#### Finding A04-1: 高成本接口缺少速率限制与滥用控制

- Risk: Medium
- Confidence: High
- Impact:
  - 上传、导入、AI 连通性测试、文档预览、考试启动等接口容易被重复调用放大资源消耗
  - 与当前 `multer`/`xlsx` 已知漏洞叠加后，DoS 面进一步放大
- Static evidence:
  - 检索 `train-exam/backend/src/index.js` 和 `train-exam/backend/package.json`，未发现 `rateLimit`、`throttle`、`429`、`express-rate-limit` 等相关实现
  - 典型高成本接口包括：
    - `POST /api/train-exam/resources/:id/upload`
    - `POST /api/train-exam/questions/import/jobs`
    - `POST /api/train-exam/ai/models/test`
    - `POST /api/train-exam/ai/models/:id/test`
    - `POST /api/train-exam/papers/:id/exam/start`
- Runtime evidence:
  - 本次未做压测，避免影响运行环境
- Recommendation:
  - 对上传、导入、AI、考试启动、证书生成等接口增加按用户/IP 的速率限制与并发上限
  - 为 AI/导入类任务加队列与单用户配额

### A05 Security Misconfiguration

#### Finding A05-1: `train-exam` 接受统一登录 Cookie，但未部署 CSRF 防护

- Risk: High
- Confidence: High
- Impact:
  - `train-exam` 后端接受 Bearer 或 Cookie 两种鉴权方式，只要浏览器带上统一登录 Cookie，状态变更请求即可执行
  - 在“同站点多系统共享 Cookie”的部署形态下，任一同站点系统被植入脚本后，都可对 `train-exam` 发起跨应用 CSRF
- Static evidence:
  - `train-exam/backend/src/index.js:200-215` `cors` 开启 `credentials: true`
  - `train-exam/backend/src/index.js:532-541` `authRequired` 明确接受 `Authorization` 或 Cookie token
  - `train-exam/backend/src/index.js` 未引入 `cookie-parser` / `csurf`
  - `auth/index.js:472-491` 统一登录系统本身有 CSRF 防护，但该能力没有延伸到 `train-exam`
  - `auth/index.js:572-580` 与 `docker-compose.yml:59-61` 表明当前 Cookie 为 `HttpOnly` + `SameSite=Lax` + `Secure=false`
- Runtime evidence:
  - 使用 `editor` 登录后，仅凭 Cookie、且不发送 `X-CSRF-Token`：
    - `POST /api/train-exam/papers/15/exam/start` 返回 `201`
    - `POST /api/train-exam/exam-sessions/20/focus-switch` 返回 `200`
  - 这两次请求都证明 `train-exam` 对 Cookie-based 写请求没有服务端 CSRF 校验
- Recommendation:
  - 最稳妥的方案是 `train-exam` API 只接受 Bearer，不接受统一登录 Cookie
  - 如果必须接受 Cookie，需要补 `cookie-parser` + `csurf` 或等效双提交 token 方案
  - 同时应重新评估共享 Cookie 的站点边界；当前多系统共站点部署会放大跨应用 CSRF 风险

### A06 Vulnerable and Outdated Components

#### Finding A06-1: 后端依赖 `multer` 存在可达的高危 DoS 漏洞

- Risk: High
- Confidence: High
- Evidence:
  - `train-exam/backend/package.json` 使用 `multer ^2.0.2`
  - `npm audit --omit=dev --json` 报告 `multer` 存在多项 high severity DoS 漏洞，修复版本需至少到 `2.1.1`
  - 可达接口：
    - `train-exam/backend/src/index.js:4397` 资源上传
    - `train-exam/backend/src/index.js:7389` 证书模板上传
    - `train-exam/backend/src/index.js:5278` Excel 导入
- Recommendation:
  - 升级到官方修复版本
  - 升级前为上传接口补充并发、速率和大小保护

#### Finding A06-2: 后端依赖 `xlsx` 存在高危原型污染和 ReDoS 风险

- Risk: High
- Confidence: High
- Evidence:
  - `train-exam/backend/package.json` 使用 `xlsx ^0.18.5`
  - `npm audit --omit=dev --json` 报告该版本落在高危漏洞范围内，且当前无自动修复可用
  - `train-exam/backend/src/index.js:5278-5306` 直接对上传的 Excel 执行 `XLSX.read(...)` 与 `sheet_to_json(...)`
- Recommendation:
  - 优先替换为已维护且无已知高危问题的解析方案
  - 若短期无法替换，至少在导入链路前增加沙箱隔离、任务队列和严格文件大小限制

#### Checked Item A06-3: 前端依赖审计当前无已知告警

- Evidence:
  - `cd train-exam/frontend && npm audit --omit=dev --json`
  - Result: `0` production vulnerabilities

### A07 Identification and Authentication Failures

#### Finding A07-1: 多个内建高权限账号仍可用旧默认口令登录

- Risk: High
- Confidence: High
- Impact:
  - `sysadmin / auditor / editor / reviewer` 均为高权限或敏感角色，攻击者可直接接管培训考试和其他系统能力
  - 该问题比“源码里出现默认值”更严重，因为已经在当前运行环境里被成功验证
- Static evidence:
  - `auth/index.js:23` 默认内建口令值仍定义为弱默认值
  - `auth/index.js:43-57` 只对当前环境变量做弱口令告警/阻断
  - `auth/index.js:496-523` `ensureBuiltinUsers` 只在“账号不存在”时写入新密码哈希；对已存在账号不会重置 `password_hash`
  - 这意味着即使 Compose 把 `BUILTIN_ACCOUNT_DEFAULT_PASSWORD` 改强，历史库里的内建账号仍可能保留旧密码
- Runtime evidence:
  - `sysadmin` 使用旧默认口令登录成功
  - `auditor` 使用旧默认口令登录成功
  - `editor` 使用旧默认口令登录成功
  - `reviewer` 使用旧默认口令登录成功
  - `admin` 本轮未能用旧默认口令登录，说明该问题是“部分高权限账号仍遗留弱口令”，不是全部账号一致失陷
- Recommendation:
  - 立刻对所有内建账号执行一次性密码轮换，并强制首次登录修改密码
  - 启动期如果发现“库中内建账号仍匹配旧默认口令”，应直接拒绝服务或进入维护模式
  - 更长期建议取消生产内建固定用户名账号，改为一次性 bootstrap 管理员

### A08 Software and Data Integrity Failures

#### Finding A08-1: 文档预览文件 token 可脱离登录态重放，且 token 中的用户字段未被消费

- Risk: Medium
- Confidence: High
- Impact:
  - 任何获得预览 URL 的人，都可以在 token 有效期内直接下载文档
  - JWT 里虽然写入了 `user_id` 和 `username`，但服务端验证时并未校验这些字段，容易造成“误以为 token 已绑定用户”的假象
- Static evidence:
  - `train-exam/backend/src/index.js:945-955` 预览 token 带有 `resource_id/user_id/username`
  - `train-exam/backend/src/index.js:957-965` 验证逻辑只检查 `purpose`
  - `train-exam/backend/src/index.js:3819-3844` `doc-preview-file` 路由定义在 `app.use('/api', authRequired)` 之前，且只校验 `resource_id`
  - `train-exam/backend/src/index.js:88` 默认 token TTL 为 `900` 秒
- Runtime evidence:
  - `editor` 访问 `GET /api/train-exam/resources/25/doc-preview-config` 返回 `200`
  - 从响应里提取 `document.url` 中的预览 token 后，在完全不带登录态的情况下访问对应文件接口，返回 `200 application/pdf`
- Recommendation:
  - `doc-preview-file` 至少补当前登录态校验，或强制比对 token 中的 `user_id` 与当前用户
  - 缩短 token TTL，并考虑一次性 token / 绑定 IP / 绑定 user-agent
  - 避免把可直接下载的 bearer URL 暴露给非必要前端方

### A09 Security Logging and Monitoring Failures

#### Finding A09-1: 审计日志偏向成功操作，拒绝访问和异常鉴权事件未持久化

- Risk: Medium
- Confidence: Medium
- Impact:
  - 攻击者枚举 `result/session/resource` 时，系统返回 `401/403` 但不会沉淀到 `te_operation_logs`
  - 事后追查越权尝试、异常 token、恶意探测时，缺乏结构化安全事件记录
- Static evidence:
  - `train-exam/backend/src/index.js:1922-1961` 的 `logOperation` 只在显式业务路径中调用
  - `train-exam/backend/src/index.js:7947-7956` 错误处理中仅对 `500` 打 stderr，`401/403/404` 不写安全审计表
  - `train-exam/backend/src/index.js:7660-7713` 虽然存在审计日志查询接口，但输入来源仍依赖成功操作日志和 AI 任务日志
- Recommendation:
  - 为鉴权失败、对象级授权失败、无效预览 token、频繁下载失败、上传异常等事件增加独立安全日志
  - 给关键安全日志补请求来源、目标对象、失败原因和节流计数

### A10 Server-Side Request Forgery (SSRF)

#### Finding A10-1: AI 模型 `base_url` 可由管理员配置，并被服务端直接请求，缺少出站目标约束

- Risk: Medium
- Confidence: High
- Impact:
  - 一旦管理员账号被拿下，或管理员误配置恶意地址，后端会主动向任意主机发起请求
  - 这可被用于探测内网、访问元数据地址或打穿仅内网可见的 HTTP 服务
- Static evidence:
  - `train-exam/backend/src/index.js:2063-2107` 运行时直接使用 `model.base_url` 拼接 `/chat/completions`
  - `train-exam/backend/src/index.js:2137-2181` 模型连通性测试同样直接请求 `base_url`
  - `train-exam/backend/src/index.js:7720-7734` 支持对“未保存模型草稿”直接发起测试
  - `train-exam/backend/src/index.js:7790-7857` 新增/更新模型时仅校验非空，没有域名、网段、协议白名单
- Runtime evidence:
  - 本轮未执行 admin-only SSRF 测试，因为当前 `admin` 登录态不可用
- Recommendation:
  - 对 `base_url` 增加协议限制、域名白名单、私网/链路本地地址拒绝
  - 将 AI 出站流量放到受限 egress 网络或代理层
  - 生产环境关闭“未保存模型直接测试”能力，或仅允许测试白名单提供方

## Top 3 Risks

1. 内建高权限账号仍可用旧默认口令登录
2. Cookie-based 状态变更请求无 CSRF 防护
3. 代码仓库与运行容器中存在硬编码密钥和口令

## Quick Fixes (1-3 Days)

1. 轮换并强制重置所有内建账号密码，尤其是 `sysadmin / auditor / editor / reviewer`
2. 为 `train-exam` 禁止 Cookie 鉴权，或立即补 CSRF 防护
3. 轮换 `JWT_SECRET`、`CONFIG_SECRET_KEY`、`AUDIT_SIGNING_KEY`、OnlyOffice 密钥、MySQL 口令
4. 升级 `multer`，并先暂停或隔离高风险 Excel 导入链路
5. 为 `doc-preview-file` 增加当前登录态绑定校验

## Long-Term Items

1. 明确课程/资源的可见性模型，决定是否要引入“按课程授权”的 ACL
2. 为 AI、上传、导入、考试启动补齐统一的速率限制、配额和任务队列
3. 把安全日志从“业务成功日志”扩展到“拒绝访问与异常鉴权日志”
4. 为所有服务统一接入 secrets 管理和弱配置启动阻断

## Verification Snapshot

本次使用的关键验证动作包括：

- `cd train-exam/backend && npm test`
- `cd train-exam/backend && npm audit --omit=dev --json`
- `cd train-exam/frontend && npm audit --omit=dev --json`
- 登录与权限探测脚本：
  - 验证 `editor/reviewer` 访问 `admin` 的 `result/session` 返回 `403`
  - 验证 `auditor` 访问同一对象返回 `200`
  - 验证 `editor` 可读取 `admin` 创建的资源文档
  - 验证仅凭 Cookie、无 `X-CSRF-Token` 即可完成 `exam/start` 与 `focus-switch`
  - 验证提取出的文档预览 token 可在无登录态下直接下载 PDF
