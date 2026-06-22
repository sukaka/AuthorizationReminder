# 聚信 AI 助手内网调试、独立版本与更新发布设计规格

**日期：** 2026-06-22
**状态：** 产品方案已确认，待书面规格复核
**Agent 初始版本：** `1.0.0`
**适用平台：** macOS Apple Silicon arm64、Windows 10/11 x64

本规格是
`2026-06-20-ai-assistant-local-launcher-updater-design.md`
的增量修订。冲突时以本规格为准；统一 SSO、本地模型、系统钥匙串、
MySQL、Prompt Center、精确 Origin 校验和签名更新边界保持不变。

## 1. 目标

本次解决三个相互关联的问题：

1. 给同事提供可连接局域网 HTTP 服务的专用测试构建，不要求内网测试机配置 HTTPS。
2. 桌面 Agent 使用自己的版本体系，从 `1.0.0` 开始，不再随平台仓库或后端版本升级。
3. 服务端提供桌面更新包的上传、校验、发布和撤回接口；更新包在开发机或 CI
   中提前编译和签名，服务端不执行编译。

客户端更新仍使用 Tauri 官方完整签名更新包。它不是二进制差分补丁，但用户无须
卸载或手动重新安装；客户端下载、校验、替换程序后自动重启。

## 2. 构建模式与 HTTP 边界

### 2.1 三种构建模式

桌面构建使用显式模式，而不是从运行环境猜测：

| 模式 | 业务服务器地址 | 更新源 | 用途 |
| --- | --- | --- | --- |
| `development` | HTTPS、loopback HTTP、私有局域网 IP HTTP | 默认禁用 | 本地源码调试 |
| `lan-test` | HTTPS、loopback HTTP、私有局域网 IP HTTP | 可连接测试更新源 | 同事内网测试安装包 |
| `production` | 仅 HTTPS | 固定正式 HTTPS 更新源 | 正式交付 |

构建期变量：

```text
AI_ASSISTANT_BUILD_MODE=development|lan-test|production
```

缺省规则：

- `tauri dev` 使用 `development`。
- 打包脚本未显式指定时必须使用 `production`，不能默认放宽为内网 HTTP。
- `lan-test` 只能由专用测试构建脚本显式生成。

### 2.2 允许的内网 HTTP 地址

`development` 和 `lan-test` 模式允许：

- `http://localhost[:port]`
- `http://127.0.0.0/8[:port]`
- `http://[::1][:port]`
- `http://10.0.0.0/8[:port]`
- `http://172.16.0.0/12[:port]`
- `http://192.168.0.0/16[:port]`

仍然拒绝：

- 公网 IP 的 HTTP。
- 普通域名或内网域名的 HTTP。
- IPv4 link-local、CGNAT、组播、广播和未明确列出的地址段。
- 包含用户名、密码、路径、查询、片段或通配符的地址。
- 运行时通过设置把 `production` 切换成 `lan-test`。

HTTPS Origin 在三种模式中均可使用。

### 2.3 用户提示

当当前构建允许私有 HTTP，且输入的是 HTTP 地址时：

- 地址输入区显示固定警告：`内网 HTTP 测试模式：通信未加密，仅用于受控局域网。`
- 登录按钮和连接状态不能掩盖该警告。
- About/版本区域显示构建渠道 `内网测试版`。
- 日志不得记录 Cookie、Token、模型密钥或响应正文。

服务端 bootstrap 返回的 SSO 门户也可以在同一私有 IP HTTP Origin 上运行，但只在
`development`/`lan-test` 模式允许。业务 Origin 和 SSO Portal 仍需分别精确校验。

## 3. Agent 独立版本

### 3.1 版本源

`juxin-ai-assistant/apps/desktop/package.json` 是 Agent 版本的唯一人工维护入口。
专用同步脚本把该版本写入：

- `apps/desktop/package-lock.json`
- `apps/desktop/src-tauri/Cargo.toml`
- `apps/desktop/src-tauri/Cargo.lock`
- `apps/desktop/src-tauri/tauri.conf.json`

平台仓库根版本、FastAPI 后端版本、Auth、Web 和其他子系统版本都不再修改 Agent
版本。平台升级时，仓库版本钩子必须明确跳过上述 Agent 版本文件。

### 3.2 初始版本和升级规则

当前桌面 Agent 版本重置为 `1.0.0`，以后独立遵守：

- 大改版：`1.0.9 -> 2.0.0`
- 功能优化：`1.0.9 -> 1.1.0`
- Bug 修复：`1.0.9 -> 1.0.10`

提供独立命令：

```text
npm run agent:version -- major|minor|patch
```

命令必须：

1. 读取 Agent 当前版本。
2. 计算下一版本。
3. 同步四个版本文件。
4. 运行版本一致性检查。
5. 不修改仓库根版本，也不自动推送。

版本提交消息使用：

```text
[agent-v1.0.1] fix(ai-assistant): ...
```

### 3.3 与现有 5.89.0 测试包的关系

`1.0.0` 小于现有内部包 `5.89.0`，更新器会把它视为降级。因此测试设备需要先卸载
旧的 `5.89.0` 内部包，再安装 Agent `1.0.0`。应用数据默认保留，但安装前仍应备份
测试数据。

发布清单继续记录可选的 `platformVersion` 便于追踪仓库来源，但它只用于审计，
不得参与 Agent 更新版本比较，也不要求与 Agent 版本相同。

## 4. 更新包生成与信任模型

### 4.1 构建端职责

开发机或受保护 CI：

1. 使用 Agent 独立版本构建 macOS arm64、Windows x64 安装包。
2. 完成平台代码签名。
3. 生成 Tauri 更新产物。
4. 使用 Tauri 更新私钥签名。
5. 输出发布描述文件、公开签名、SHA-256、平台、架构、文件大小和更新说明。
6. 将产物上传到更新服务。

Tauri 更新私钥、Apple Developer ID 和 Windows Authenticode 私钥不得上传到业务
服务、数据库、对象存储或管理页面。

### 4.2 服务端职责

更新服务只负责：

- 接收已经构建并签名的升级包。
- 校验元数据、文件大小、SHA-256、平台、架构和版本单调递增。
- 保存升级包和公开签名。
- 维护草稿、已发布、已撤回状态。
- 为客户端生成 Tauri 2 兼容更新清单。
- 提供 HTTPS/受控内网测试 HTTP 下载。
- 记录不含秘密和业务正文的发布审计。

服务端不得：

- 编译桌面应用。
- 生成或持有 Tauri 更新私钥。
- 修改上传的包或签名。
- 把业务服务器地址当成更新地址。
- 仅修改版本号却没有对应真实升级包。

## 5. 服务端数据模型

新增 `desktop_update_releases`：

```text
uuid
agent_version
channel                 lan-test | production
status                  DRAFT | PUBLISHED | WITHDRAWN
release_notes
published_at
published_by
created_at
created_by
```

新增 `desktop_update_artifacts`：

```text
uuid
release_uuid
target                  darwin-aarch64 | windows-x86_64
file_name
storage_key
content_type
size_bytes
sha256
tauri_signature
created_at
```

约束：

- 同一 channel、Agent 版本、target 只能有一个产物。
- 发布至少需要当前要求的平台产物。内部阶段可只发布 `lan-test`
  的 macOS arm64；`production` 必须同时具备 macOS arm64 和 Windows x64。
- 已发布记录不可原地替换文件。需要修复时发布更高 Agent 版本。
- 撤回只阻止新的检查和下载，不删除审计记录。

升级包可存本地受控目录或对象存储。数据库只保存元数据和存储键，不保存大二进制
BLOB。下载路径由服务端映射，禁止用户输入任意文件系统路径。

## 6. 管理接口

所有写接口要求现有统一 SSO `admin`/`sysadmin` 权限、CSRF/同源保护和审计。

### 6.1 创建发布草稿

```http
POST /api/ai/admin/desktop-updates
Content-Type: application/json

{
  "agent_version": "1.0.1",
  "channel": "lan-test",
  "release_notes": "验证自动更新闭环"
}
```

服务端拒绝非法 SemVer、低于或等于当前同 channel 已发布版本的版本号。

### 6.2 上传预构建产物

```http
POST /api/ai/admin/desktop-updates/{release_uuid}/artifacts
Content-Type: multipart/form-data

target=darwin-aarch64
sha256=<64位小写十六进制>
signature=<Tauri公开签名>
file=<预构建升级包>
```

上传流程：

1. 流式写入同存储卷临时文件，并限制单文件大小。
2. 服务端重新计算 SHA-256，不能只信任请求值。
3. 校验扩展名、target、版本文件名和基本二进制架构。
4. 原子移动到不可变存储键。
5. 保存元数据。

服务端不能验证 Tauri 私钥是否正确，但客户端安装前必须使用内置公钥验证签名。
测试和 CI 还应使用 Tauri 工具对上传样本执行端到端验证。

### 6.3 发布与撤回

```http
POST /api/ai/admin/desktop-updates/{release_uuid}/publish
POST /api/ai/admin/desktop-updates/{release_uuid}/withdraw
```

“发布更新”只把已上传且校验通过的版本切换为 `PUBLISHED`，不触发构建。

发布操作必须在单个数据库事务中：

1. 锁定 channel 当前状态。
2. 再次验证版本高于当前已发布版本。
3. 验证所需 target 产物完整。
4. 写入发布状态、操作人和时间。
5. 写审计日志。

## 7. 客户端公开接口

客户端不使用管理员上传接口，只访问构建时固定的更新 Origin。

```http
GET /api/ai/desktop/updates/{channel}/{target}/{arch}/latest.json
GET /api/ai/desktop/updates/files/{artifact_uuid}
```

`latest.json` 使用 Tauri 2 兼容格式，包含：

```json
{
  "version": "1.0.1",
  "notes": "验证自动更新闭环",
  "pub_date": "2026-06-22T12:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "<公开签名>",
      "url": "https://updates.example.com/api/ai/desktop/updates/files/..."
    }
  }
}
```

响应要求：

- 没有更高已发布版本时返回 HTTP `204 No Content`。
- `DRAFT` 和 `WITHDRAWN` 永不出现在清单中。
- 下载响应支持 `Content-Length`、安全文件名、缓存和断点续传。
- `lan-test` 客户端只检查 `lan-test` channel；production 客户端只检查
  `production` channel，用户不能在设置中切换。

这里的“推送”仍定义为：管理员发布后，客户端在启动延迟检查、6 小时轮询或手动
“检查更新”时立即发现。第一版不建设 WebSocket 长连接。

## 8. 管理页面

治理中心新增“桌面端更新”页面：

- 显示 Agent 当前发布版本，不显示平台仓库版本为客户端版本。
- 创建版本草稿。
- 分别上传 macOS arm64 和 Windows x64 升级包、SHA、签名。
- 显示服务端复算 SHA、大小、平台、架构和校验状态。
- “发布测试更新”按钮仅用于 `lan-test` channel。
- “发布正式更新”按钮必须满足双平台和正式签名门槛。
- 发布前二次确认版本、channel、平台和更新说明。
- 可撤回当前版本，但不能编辑或覆盖已发布文件。

页面不接受、展示或保存任何签名私钥。

## 9. 客户端更新流程

以 `lan-test` 的 `1.0.0 -> 1.0.1` 为例：

1. CI 构建并签名 Agent `1.0.1`。
2. 管理员创建 `1.0.1` 草稿并上传升级包和公开签名。
3. 服务端复算 SHA 并校验平台/架构。
4. 管理员点击“发布测试更新”。
5. `1.0.0` 客户端自动轮询或用户点击“检查更新”。
6. 客户端显示 `1.0.1`、更新说明和大小。
7. 用户点击“下载并安装”。
8. Tauri 使用内置公钥校验签名，校验失败则停止安装。
9. 校验成功后替换应用程序并自动重启。
10. 重启后显示 Agent `1.0.1`，保留服务器地址、模型配置、钥匙串密钥、草稿和待同步队列。

第一版下载完整更新产物，不是只下载修改文件。未来增加差分更新时必须保留完整包
回退，且不能改变本规格的签名验证和数据保留要求。

## 10. 测试策略

### 10.1 地址策略

- production 拒绝所有 HTTP。
- development/lan-test 接受 loopback 和三个 RFC1918 IPv4 私有地址段。
- 拒绝公网 IP、HTTP 域名、CGNAT、link-local、userinfo、路径和 wildcard。
- 前端、Rust、连接探测、SSO Portal 和 workspace capability 使用同一策略。
- UI 对 HTTP 始终显示不可消除的未加密警告和构建渠道。

### 10.2 独立版本

- 平台版本升级不会修改 Agent 的五个版本位置。
- `agent:version patch` 精确执行 `1.0.0 -> 1.0.1`。
- Agent 升版不会修改仓库根、后端或其他应用版本。
- Cargo、Tauri、npm、锁文件和发布清单保持一致。
- 更新比较只使用 Agent 版本，不使用 `platformVersion`。

### 10.3 服务端发布

- 非管理员不能创建、上传、发布或撤回。
- 上传 SHA 不一致、版本/平台/架构错误和超限文件被拒绝且临时文件被清理。
- 私钥字段和 secret-like 元数据被拒绝。
- 并发发布只能有一个成功，不允许版本倒退或同版本覆盖。
- 草稿和撤回版本不进入公开清单。
- 发布 `1.0.1` 后，`lan-test` 最新清单精确返回对应签名和下载 URL。
- 下载不能路径穿越，且返回的文件 SHA 与上传复算值一致。

### 10.4 端到端

- `1.0.0` lan-test 客户端通过私有 IP HTTP 完成 bootstrap 和统一登录。
- 管理员上传并发布预构建 `1.0.1` 测试包。
- 客户端手动检查后出现 `1.0.1`。
- 下载取消、重新下载、签名失败、安装失败均保留 `1.0.0` 可运行。
- 使用真实签名测试包完成安装、自动重启和数据保留验证。

## 11. 安全与运维

- `lan-test` 安装包必须有不同渠道标识，不能作为正式包分发。
- 私有 HTTP 只适用于受控局域网，测试账号和数据按非生产级别管理。
- 更新服务上传目录禁止执行；文件使用随机不可预测 storage key。
- 发布和撤回写入现有 AI 审计，元数据不包含包内容、签名私钥、Cookie 或 Token。
- 更新 Origin、公钥和 channel 在构建期固定，业务服务器输入不能修改。
- production 下载必须使用 HTTPS；lan-test HTTP 更新源仅允许私有 IP，并由编译期渠道锁定。
- 备份发布数据库和不可变产物存储；撤回不物理删除产物，按保留策略离线清理。

## 12. 成功标准

以下仓库内条件全部满足，才算本轮实现完成：

1. Agent 五个版本位置统一为 `1.0.0`，且平台/后端升版不会改变它。
2. lan-test 构建可连接 RFC1918 私有 IP HTTP，并持续显示未加密警告；production 构建拒绝该地址。
3. 管理员可以上传已构建、已签名的 `1.0.1` 测试升级包，服务端不编译、不持有私钥。
4. 点击“发布测试更新”后，公开清单返回 `1.0.1`，草稿和撤回版本不可见。
5. `1.0.0` 客户端可发现、下载、签名校验、安装并自动重启到 `1.0.1`。
6. 更新失败不破坏当前客户端，不丢失服务器地址、模型配置、钥匙串密钥、草稿和待同步数据。
7. macOS arm64 与 Windows x64 的正式发布仍须分别完成平台代码签名和真实安装验收。
