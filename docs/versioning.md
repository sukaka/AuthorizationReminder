# 多系统独立版本规范

本仓库的业务系统分别维护版本，不再使用单一全局产品版本。每个系统的 `VERSION` 文件是唯一版本来源；同一系统内声明的前端、后端、网关、桌面端及部署运行时版本必须与它一致。

根 `package.json` 和根 `package-lock.json` 固定为 `1.0.0`，仅代表版本工具包，不参与业务系统自动升版。

## 1. 系统版本源

系统边界由 `scripts/versioning/systems.js` 显式注册，不能通过目录遍历自动创建版本单元。

| 系统 scope | 业务系统 | 归属路径 | 唯一版本源 |
| --- | --- | --- | --- |
| `auth` | 统一登录系统 | `auth/` | `auth/VERSION` |
| `reminder` | 授权到期提醒 | `server/`、`web/` | `server/VERSION` |
| `ticketing` | 工单管理 | `ticketing/` | `ticketing/VERSION` |
| `inventory` | 库存管理 | `inventory-system/` | `inventory-system/VERSION` |
| `device-flow` | 设备流转 | `device-flow/` | `device-flow/VERSION` |
| `delivery` | 交付记录 | `delivery/` | `delivery/VERSION` |
| `sec-impl` | 聚信实施记录 | `sec-impl/` | `sec-impl/VERSION` |
| `cmdb` | CMDB | `cmdb/` | `cmdb/VERSION` |
| `faq` | FAQ | `faq/` | `faq/VERSION` |
| `tender` | 标书系统 | `tender/` | `tender/VERSION` |
| `train-exam` | 培训考试 | `train-exam/` | `train-exam/VERSION` |
| `prompt-center` | 提示词管理中心 | `prompt-center/` | `prompt-center/VERSION` |
| `sca` | 软件成分分析平台 | `sca-platform/` | `sca-platform/VERSION` |
| `big-screen` | 统一大屏展示中心 | `big-screen-center/` | `big-screen-center/VERSION` |
| `ai-assistant` | 聚信 AI 助手 | `juxin-ai-assistant/` | `juxin-ai-assistant/VERSION` |

新增系统时，必须同时注册系统 ID、归属路径、`VERSION` 文件和需要同步的 package/lock、JSON、TOML、Cargo.lock 目标 package 或声明式 `versionTargets`。`versionTargets` 只允许指向该系统归属路径或共享路径，每个 selector 必须唯一匹配命名为 `version` 的版本字段，并在 registry 校验时与 `VERSION` 一致。

AI 助手后端 `Settings.app_version` 与根 Compose 的 `ai-assistant-api` 部署版本，以及 SCA 后端、系统 Compose、`.env.example` 和根 Compose 四个 SCA 服务的应用版本，均作为声明式运行时/部署目标同步。根 Compose 虽由多个系统共享，但每个目标按服务字段独立定位；具体系统 scope 只更新该系统目标，`all` 会合并全部系统在共享文件中的非重叠编辑。

## 2. 语义版本规则

版本格式统一为 `主版本.次版本.修订号`：

- 大改版：升级第一位，后两位归零，例如 `4.0.9 -> 5.0.0`。
- 功能新增或优化：升级第二位，第三位归零，例如 `4.0.9 -> 4.1.0`。
- Bug 修复或维护：升级第三位，例如 `4.0.9 -> 4.0.10`。

提交类型映射：

- `breaking:`、`major:` 或 Conventional Commit 的 `!`：主版本。
- `feat:`、`minor:`、`perf:`：次版本。
- `fix:`、`patch:`、`docs:`、`chore:`、`style:`、`refactor:`、`test:`、`build:`、`ci:`、`revert:`：修订号。
- `Merge`、`fixup!`、`squash!`：不自动升版。

一次提交影响多个系统时，各系统基于自己的当前版本使用同一升级级别，未命中的系统不变。

### 聚信 AI 助手与微信 H5 的版本边界

聚信 AI 助手的统一版本源是 `juxin-ai-assistant/VERSION`；桌面端、Tauri/Cargo 和服务端声明式运行时版本均由该源同步。微信 H5 当前是独立的未发布工作树包，暂未纳入 `ai-assistant` 系统注册表，因此不会被根仓库的版本钩子自动升版。

在明确 H5 是否与桌面/后端共用发布生命周期前，不要手工把 H5 版本改成聚信 AI 助手的当前版本，也不要把它加入注册表；这两种动作都会改变发布语义。确定共版后，应一次性补齐 package/lock、注册表、测试 fixture 和文档，并按本节规则执行版本升级。

## 3. 路径与 scope

- 业务目录按注册表路径自动归属系统。
- 单系统提交可使用对应 scope，例如 `fix(auth): 修复登录超时`。
- 一次提交修改多个系统目录时，不写单系统 scope；自动化按路径识别全部系统。
- 根 `docker-compose*.yml`、统一部署脚本、README 和跨系统基础设施属于共享文件。共享文件必须使用具体系统 scope 或 `all`，不能使用 `repo`。
- `all` 表示确实影响全部系统；`repo` 仅用于仓库自身且不属于共享路径的变更，例如版本工具或独立仓库文档。
- scope 与实际业务路径冲突、未知 scope、缺失/非法 `VERSION` 或注册路径重叠都会阻止提交。

示例：

- `feat(inventory): 增加库存批量导入`
- `fix(auth): 修复登录超时`
- `feat: 联动优化登录与库存`
- `feat(all): 更新所有系统公共入口协议`
- `chore(repo): 调整版本自动化测试`

## 4. 自动 amend 与推送

安装本地 Hook：

```bash
npm run hooks:install
```

自动化流程：

1. `commit-msg` 只校验提交 type/scope 语法，并清理手写的版本前缀；它不读取提交变更路径。
2. `post-commit` 校验注册表，根据本次提交的变更路径验证系统 scope，并计算受影响系统及升级级别。
3. 自动同步注册表声明的 `VERSION`、package/lock、JSON、TOML、Cargo.lock 目标 package 和声明式运行时/部署版本字段；只更新已声明且唯一匹配的目标，Cargo.lock 依赖包及 Compose 中的依赖工具版本保持不变。
4. 使用 `git commit --amend` 把版本文件和系统版本前缀并入原提交。
5. 推送当前分支；没有 upstream 时为当前分支建立 upstream。

amend 过程会临时 stash 用户的 staged、unstaged 和 untracked 改动。只有 amend 与 stash 恢复都成功才算事务完成；若最终 stash 恢复冲突，自动化会恢复原 HEAD、清理冲突状态，再在原 HEAD 上按原索引状态恢复用户改动并删除自动 stash，随后抛出最初的恢复错误。

系统升版不会创建或切换分支，也不会把分支重命名为版本号。部署应使用稳定分支或显式配置的业务分支，不能依赖 `codex/<版本号>`。

版本自动化自身迁移或紧急维护可临时设置 `CODEX_VERSIONING_BYPASS=1` 跳过 amend/push；普通业务提交不得使用旁路。

## 5. 提交标题

自动修订后的标题按系统 ID 稳定排序：

- 单系统：`[inventory-v1.1.0] feat(inventory): 增加库存批量导入`
- 多系统：`[auth-v1.1.0][inventory-v1.1.0] feat: 联动优化登录与库存`
- 仓库工具：`[repo] chore(repo): 调整版本自动化测试`

不再生成 `[v1.2.3]` 这类全局产品版本前缀。

## 6. 分支、标签与发布文档

- 分支名称与系统版本解耦；自动化只 amend 并推送当前分支。
- 如需发布标签，必须带系统 ID，例如 `inventory-v1.2.0`、`auth-v1.0.3`，避免不同系统版本冲突。
- 自动化不创建标签；标签由发布流程在审核后创建。
- 新发布说明应明确目标系统及其版本。已有 `docs/releases/`、历史提交、历史分支和历史标签保持不变，用于审计与回滚。

## 7. 校验

提交版本自动化变更前至少运行：

```bash
npm run test:versioning
node --test juxin-ai-assistant/apps/desktop/scripts/tests/agent-version.test.mjs
node -e "JSON.parse(require('fs').readFileSync('package.json')); JSON.parse(require('fs').readFileSync('package-lock.json'))"
git diff --check
```

仓库一致性测试会检查全部 15 个 `VERSION` 源、注册表声明的运行时版本（包括 AI 助手 Cargo.lock 目标 package、AI/SCA 后端与 Compose 部署字段），以及根版本工具包是否保持一致。
