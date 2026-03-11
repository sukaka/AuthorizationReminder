# CMDB 存储依赖收口设计

**日期：** 2026-03-12  
**范围：** `/Users/zhanglei/Documents/codex-new/cmdb` 与根目录编排文件  
**目标：** 让 CMDB 后续只依赖 MySQL，清理旧的非关系型存储运行时、配置、依赖与部署痕迹。

## 背景

当前仓库中只有 CMDB 服务保留了历史遗留的第二存储接入，但代码检查结果表明：

- `cmd/cmdb/main.go` 启动时会强制建立一条额外数据库连接。
- `internal/handler/router.go` 接收了预留客户端参数，但没有实际使用。
- 业务 API、模型管理、CI、关系、变更、自动发现、报表分析均走 MySQL 仓储。
- 当前保留的附加存储实例中没有业务集合和业务数据。

这意味着这条依赖并不承担实际业务职责，而是历史预留路径。继续保留会增加部署复杂度、误导维护者，并引入无意义的启动失败面。

## 目标

- CMDB 服务启动时不再连接历史遗留的附加存储。
- 代码库不再保留对应驱动与配置项。
- 本地与部署编排不再创建该存储容器。
- 文档明确 CMDB 仅使用 MySQL 作为持久化存储。
- 已有业务能力保持不变。

## 非目标

- 不新增 MySQL 表去模拟不存在的快照能力。
- 不重构现有 MySQL 业务仓储结构。
- 不处理与 CMDB 无关的其他系统依赖。

## 方案选型

### 方案 A：彻底移除历史附加存储（采纳）

直接删除旧存储的运行时依赖、Go 驱动、Docker 服务、环境变量和文档说明。

优点：
- 与当前真实业务结构一致。
- 运行与部署链路最简。
- 降低未来维护和误判成本。

缺点：
- 如果未来真要引入新的原始快照能力，需要重新设计落库方案。

### 方案 B：只移除运行时依赖

服务不再连接旧存储，但保留 Go 依赖、文档和 schema 目录。

优点：
- 代码 diff 更小。

缺点：
- 仓库仍持续表达错误架构事实。
- 新人会误以为 CMDB 仍依赖第二存储。

### 方案 C：保留兼容开关

增加配置开关，让旧存储可选。

优点：
- 表面兼容性更好。

缺点：
- 对当前空使用场景属于过度设计。
- 会继续保留死代码和死配置。

## 详细设计

### 1. 启动链路

- 删除额外存储客户端初始化调用。
- 删除对应的关闭与清理逻辑。
- `handler.NewRouter` 改为只接收 `cfg` 和 `sqlDB`。

### 2. 配置与依赖

- 删除 `config.Config` 中与旧存储有关的字段。
- 删除环境变量读取逻辑。
- 删除历史数据库接入 helper 文件。
- 删除对应 Go 驱动依赖，并同步 `go.sum`。

### 3. 编排与部署

- 根目录 `docker-compose.yml` 删除旧存储服务、卷、健康检查及 `cmdb` 的附加依赖和环境变量。
- `cmdb/deploy/docker-compose.yml` 做同样清理。
- 保留 Kafka、MySQL、Auth、Web 相关依赖不变。

### 4. 文档与结构

- 更新 `cmdb/README.md`，将存储表述改为 MySQL-only。
- 删除旧 schema 目录内容，避免继续误导。
- 如果部署说明引用旧存储创建步骤，一并移除。

## 影响评估

### 正向影响

- 减少一个数据库容器与相关资源占用。
- 消除附加存储异常导致 CMDB 启动失败的风险。
- 让代码与文档反映真实系统边界。

### 风险

- 某些未纳入仓库的外部脚本可能仍传入旧环境变量。
- 文档引用若清理不全，会造成部署说明不一致。

### 风险控制

- 全仓库检索旧依赖关键字并逐项处理。
- 执行 `go test ./...` 与 `go mod tidy`，验证编译和依赖闭环。
- 通过 `docker compose up -d --build cmdb web-cmdb` 做运行态验证。

## 验证方案

1. 编译与测试
   - `cd /Users/zhanglei/Documents/codex-new/cmdb && go test ./...`
   - `cd /Users/zhanglei/Documents/codex-new/cmdb && go mod tidy`
2. 编排验证
   - `cd /Users/zhanglei/Documents/codex-new && docker compose up -d --build cmdb web-cmdb`
   - `docker compose ps | rg 'cmdb|web-cmdb'`
3. 健康与功能验证
   - `curl -sS http://localhost:8090/healthz`
   - 容器内访问 `http://127.0.0.1:8088/healthz`
   - 登录后检查模型管理、自动发现、报表分析页面

## 回滚策略

如果移除后发现存在仓库外的隐式依赖：

- 恢复 `docker-compose.yml` 与 `cmdb/deploy/docker-compose.yml` 的历史附加存储服务定义。
- 恢复 `config.go`、`main.go`、`router.go` 中的旧客户端连接代码。
- 重新构建 `cmdb` 与 `web-cmdb` 容器。

当前由于附加存储没有业务数据，回滚不涉及数据迁移。
