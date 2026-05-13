# 企业提示词管理中心设计

## 背景

参考 Langfuse 的 Prompt Management 思路，建设一套适合公司内部使用的提示词管理系统。第一版不接模型调用，不做 tracing、evaluation、dataset 或 playground，只聚焦提示词资产管理、部门隔离、分类治理、版本发布和审计。

系统需要接入现有统一登录，并在视觉和交互上保持与培训考试系统一致：左侧导航、顶部概览区、筛选区、表格、弹层编辑、状态标签和操作按钮都沿用考试系统的工作台风格。

## 目标

1. 让不同部门维护自己的提示词资产。
2. 让提示词按一级分类和标签组织，便于销售、技术等团队检索复用。
3. 支持提示词草稿、发布、归档和版本回滚。
4. 支持统一登录鉴权、按部门授权、操作审计。
5. 第一版只管理提示词文本和变量，不接任何大模型接口。

## 非目标

1. 不接在线模型测试。
2. 不做 Langfuse tracing、datasets、evals。
3. 不做多级分类树，第一版只支持部门下一级分类。
4. 不做跨系统自动调用 SDK，先提供 Web 管理和 REST API。
5. 不做复杂审批流，第一版使用草稿、已发布、已归档三态。

## 系统形态

新增独立子系统：

- 后端服务：`prompt-center-api`
- 前端服务：`web-prompt-center`
- 系统 key：`prompt-center`
- 后端端口建议：`5191`
- 前端端口建议：`18088`
- 数据库建议：`juxin_prompt_center`

统一登录配置新增：

- `APP_PROMPT_CENTER_URL=http://localhost:18088`
- `AUTH_SYSTEM_KEY=prompt-center`

统一门户显示名称：

- 全称：`提示词管理中心`
- 短名称：`提示词中心`

## 角色与权限

沿用现有统一登录角色，不新增登录角色。

| 角色 | 权限 |
| --- | --- |
| `admin` | 全局管理所有部门、分类、提示词、版本和审计日志 |
| `editor` | 管理自己所属部门的分类和提示词，可创建草稿、编辑草稿、归档本部门提示词 |
| `reviewer` | 查看并发布自己所属部门提示词，可回滚到历史版本 |
| `auditor` | 只读查看所有部门提示词、版本和审计日志 |
| `user` / `viewer` | 查看自己所属部门已发布提示词 |
| `sysadmin` | 不进入业务数据，仅通过统一登录管理账号和安全策略 |

部门范围依赖统一登录中的用户部门信息。若用户没有部门，普通用户只能看到空状态；`admin` 和 `auditor` 不受部门限制。

## 信息架构

左侧导航：

1. 总览
2. 提示词库
3. 分类管理
4. 部门管理
5. 版本记录
6. 审计日志

总览展示：

- 提示词总数
- 已发布数量
- 草稿数量
- 分类数量
- 最近更新提示词
- 按部门统计

提示词库支持筛选：

- 部门
- 分类
- 状态
- 标签
- 关键词

## 数据模型

### 部门

`prompt_departments`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `code` | 部门编码，唯一 |
| `name` | 部门名称 |
| `description` | 部门说明 |
| `is_active` | 是否启用 |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

部门可以从统一登录部门表同步，也可以由提示词中心维护一份业务部门映射。第一版推荐复用统一登录部门数据，提示词中心只保存必要的部门配置和启用状态。

### 分类

`prompt_categories`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `department_code` | 所属部门 |
| `name` | 分类名称，如客户沟通话术、客户访问总结、方案编写 |
| `description` | 分类说明 |
| `sort_order` | 排序 |
| `is_active` | 是否启用 |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

分类第一版只支持一级分类。分类名称在同一部门内唯一。

### 提示词

`prompts`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `department_code` | 所属部门 |
| `category_id` | 所属分类 |
| `title` | 提示词标题 |
| `scenario` | 适用场景 |
| `content` | 提示词正文 |
| `variables_json` | 变量定义 |
| `tags_json` | 标签 |
| `status` | `draft`、`published`、`archived` |
| `current_version_id` | 当前版本 |
| `created_by` | 创建人 |
| `updated_by` | 更新人 |
| `published_by` | 发布人 |
| `published_at` | 发布时间 |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

变量使用 `{{变量名}}` 格式，例如：

```text
请基于以下客户信息生成拜访总结：
客户名称：{{客户名称}}
拜访目的：{{拜访目的}}
沟通内容：{{沟通内容}}
下一步计划：{{下一步计划}}
```

### 版本

`prompt_versions`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `prompt_id` | 提示词 ID |
| `version_no` | 版本号，从 1 开始递增 |
| `title` | 版本标题快照 |
| `scenario` | 场景快照 |
| `content` | 正文快照 |
| `variables_json` | 变量快照 |
| `tags_json` | 标签快照 |
| `change_note` | 变更说明 |
| `created_by` | 创建人 |
| `created_at` | 创建时间 |

每次保存提示词正文、变量或标签时生成新版本。回滚时复制历史版本内容并生成一个新的版本，不直接改写历史版本。

### 审计日志

`prompt_audit_logs`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `actor_id` | 操作人 ID |
| `actor_username` | 操作人 |
| `actor_role` | 操作角色 |
| `department_code` | 影响部门 |
| `entity_type` | `department`、`category`、`prompt`、`version` |
| `entity_id` | 业务对象 ID |
| `action` | `create`、`update`、`publish`、`archive`、`rollback`、`delete` |
| `summary` | 操作摘要 |
| `metadata_json` | 扩展信息 |
| `created_at` | 操作时间 |

## 页面设计

### 总览

采用培训考试系统 hero + 统计卡片样式。展示全局或当前部门的统计数据。普通用户只看到自己部门数据，`admin` 和 `auditor` 可切换部门。

### 提示词库

主页面包含：

- 顶部筛选条：部门、分类、状态、关键词。
- 表格列：标题、部门、分类、标签、状态、当前版本、更新时间、操作。
- 操作：查看、编辑、发布、归档、版本。

普通用户只能查看已发布提示词。编辑和发布按钮根据角色隐藏或禁用。

### 提示词编辑弹层

字段：

- 标题
- 部门
- 分类
- 场景说明
- 标签
- 提示词正文
- 变量列表
- 变更说明

正文输入区旁边提供变量检测：

- 自动扫描 `{{变量名}}`
- 展示变量缺失或重复
- 支持复制最终提示词模板

### 版本记录

展示某个提示词的所有版本：

- 版本号
- 创建人
- 创建时间
- 变更说明
- 操作：查看、对比、回滚

第一版对比使用左右文本差异，不做复杂富文本 diff。

### 分类管理

按部门展示一级分类。支持新增、编辑、启用、停用。停用分类后，不影响已有提示词查看，但不能再用于新建提示词。

### 部门管理

`admin` 可查看部门配置和启用状态。若部门来自统一登录，只允许启用、停用和补充说明，不允许在提示词中心修改部门编码。

### 审计日志

支持按操作人、部门、动作、对象类型、时间范围筛选。`auditor` 可查看全部，部门角色只能查看自己部门。

## API 草案

所有接口都走统一登录鉴权。

```text
GET    /api/prompt-center/auth/me
GET    /api/prompt-center/overview

GET    /api/prompt-center/departments
POST   /api/prompt-center/departments
PUT    /api/prompt-center/departments/:code

GET    /api/prompt-center/categories
POST   /api/prompt-center/categories
PUT    /api/prompt-center/categories/:id

GET    /api/prompt-center/prompts
POST   /api/prompt-center/prompts
GET    /api/prompt-center/prompts/:id
PUT    /api/prompt-center/prompts/:id
POST   /api/prompt-center/prompts/:id/publish
POST   /api/prompt-center/prompts/:id/archive

GET    /api/prompt-center/prompts/:id/versions
GET    /api/prompt-center/prompts/:id/versions/:versionId
POST   /api/prompt-center/prompts/:id/versions/:versionId/rollback

GET    /api/prompt-center/audit-logs
```

## 权限规则

后端是权限唯一可信源。

1. `admin` 可访问全部部门。
2. `auditor` 可只读全部部门。
3. `editor` 只能写自己部门。
4. `reviewer` 只能发布和回滚自己部门。
5. `user` / `viewer` 只能读自己部门已发布提示词。
6. `sysadmin` 请求业务接口返回 403。
7. 停用部门下的提示词仍可被 `admin` / `auditor` 查看，但普通用户不可见。

## 审计要求

以下操作必须记录审计：

- 创建提示词
- 编辑提示词
- 发布提示词
- 归档提示词
- 回滚版本
- 创建或修改分类
- 修改部门启用状态

审计日志必须包含操作人、角色、部门、对象、动作和摘要。

## 测试策略

后端测试：

- 部门范围过滤
- 分类唯一性
- 提示词创建与版本生成
- 发布、归档、回滚
- 各角色权限矩阵
- 审计日志写入

前端测试：

- 源码级测试确认菜单、筛选和关键文案存在
- 变量扫描函数测试
- 权限状态下按钮显示规则测试

集成验证：

- 使用统一登录 token 访问 `prompt-center`
- 普通用户只能看到自己部门已发布提示词
- `editor` 不能发布，`reviewer` 不能编辑正文
- `auditor` 只能查看不能修改

## 第一版验收标准

1. 统一门户中能看到“提示词管理中心”入口。
2. 登录后能进入提示词中心，页面风格与培训考试系统一致。
3. `admin` 能维护部门启用状态、分类、提示词。
4. `editor` 能维护自己部门的草稿提示词。
5. `reviewer` 能发布和回滚自己部门提示词。
6. 普通用户能查看自己部门已发布提示词。
7. 提示词修改会生成版本记录。
8. 发布、归档、回滚等关键动作写入审计日志。
9. 第一版不出现任何模型 API key、模型调用配置或在线生成入口。

## 后续演进

1. 接入模型配置和在线测试。
2. 增加 Prompt 调用 SDK 和版本锁定能力。
3. 增加效果评分、测试集、人工评审。
4. 增加跨部门共享和收藏。
5. 增加提示词导入导出。
