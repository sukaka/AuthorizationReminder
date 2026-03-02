# OWASP 黑盒渗透测试清单（统一认证/提醒/FAQ/流转/CMDB/库存/工单/标书）

日期：2026-02-27

## 1. 目标系统与默认地址
- 统一认证：`AUTH_BASE=http://localhost:5180`
- 提醒系统：`REMINDER_BASE=http://localhost:5179`
- FAQ：`FAQ_BASE=http://localhost:5186`
- 设备流转：`DEVICE_FLOW_BASE=http://localhost:5184`
- 实施记录系统（安全实施流转）：`SEC_IMPL_BASE=http://localhost:5185`
- CMDB：`CMDB_BASE=http://localhost:8090`
- 库存管理系统：`INVENTORY_BASE=http://localhost:5183`
- 工单管理系统：`TICKETING_BASE=http://localhost:5182`
- 标书协同制作系统：`TENDER_BASE=http://localhost:5187`

## 2. 准备条件
- 至少准备一个管理员令牌：`ADMIN_TOKEN`
- 建议再准备：
  - 审计员令牌：`AUDITOR_TOKEN`
  - 编辑员令牌：`EDITOR_TOKEN`
- 默认仅执行只读探测。
- 若要执行写入型验证（会创建测试数据）：`RUN_WRITE_TESTS=true`

## 3. 一键执行命令
```bash
ADMIN_TOKEN='xxx' \
AUDITOR_TOKEN='xxx' \
EDITOR_TOKEN='xxx' \
./scripts/security/owasp-blackbox-suite.sh
```

写入型验证（包含附件上传绕过探测）：
```bash
ADMIN_TOKEN='xxx' \
AUDITOR_TOKEN='xxx' \
EDITOR_TOKEN='xxx' \
RUN_WRITE_TESTS=true \
./scripts/security/owasp-blackbox-suite.sh
```

## 4. 脚本覆盖项
- A01 访问控制
  - 未登录访问受保护接口（应 401）
  - 低权限角色访问高权限接口（应 403）
  - 审计接口角色隔离（按系统策略断言）
  - `inventory`/`tender`：`admin=403`，`auditor=200`
  - `ticketing`：`editor=403`，`admin=200`，`auditor=200`
- A03 注入
  - 关键列表查询注入载荷（`' OR 1=1 --`）
  - 覆盖端点：`reminder/customers`、`faq/articles`、`device-flow/jobs`、`sec-impl/projects`、`cmdb/ci`、`inventory/products`、`ticketing/tickets`、`tender/bids`
  - 验证“不应出现 500 与 SQL 报错泄露”
- A05 安全错误配置
  - 基础安全响应头检查（`X-Content-Type-Options`）
  - CORS 恶意 Origin 阻断检查（含 `inventory`/`ticketing`/`tender`）
- A10 SSRF 相关
  - FAQ 编辑回调入口在恶意 URL 输入下不应触发 500
- 上传绕过（可选）
  - `device-flow` / `sec-impl` 对 `text/x-shellscript` 上传应拒绝（400）

## 5. 手工补充测试（建议）
以下场景建议在预发环境由人工二次验证：
- 统一认证登录口令爆破节流
  - 连续错误密码，观察锁定/验证码触发是否符合预期
- FAQ / Tender 在线编辑回调 SSRF 深测
  - 使用真实 `sessionKey + callback token`，验证域名白名单强制效果
- IDOR 深测
  - 以普通用户访问不属于自己的业务对象 ID
- 文件上传链路
  - 多 MIME 伪造（扩展名与 Content-Type 不一致）
  - 大文件上限与分块绕过尝试
- CMDB 审计导出
  - 高并发导出与筛选关键字边界值

## 6. 常用排查命令
查看失败用例详情：
```bash
./scripts/security/owasp-blackbox-suite.sh || true
```

仅检查服务可达性（快速预检）：
```bash
for u in \
  http://localhost:5180/health \
  http://localhost:5179/api/health \
  http://localhost:5186/api/health \
  http://localhost:5184/api/health \
  http://localhost:5185/api/health \
  http://localhost:8090/healthz \
  http://localhost:5183/api/health \
  http://localhost:5182/health \
  http://localhost:5187/health; do
  echo "==> $u"
  curl -sS -o /dev/null -w '%{http_code}\n' "$u" || true
done
```

## 7. 结果判定
- `PASS`：符合安全预期
- `FAIL`：存在可疑风险，需立刻复核并修复
- `SKIP`：缺少令牌或服务未启动，需补条件后复测
