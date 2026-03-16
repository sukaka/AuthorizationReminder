# 文档管理系统全局库与部门库设计

**目标**

在现有 `faq` 文档管理系统中引入“全局库 + 部门库”双层文库模型，支持部门隔离、跨部门申请查看、部门二级管理员审批，以及统一登录侧的部门主数据与权限透传。

**设计结论**

- 统一登录 `auth` 仍是部门唯一来源，用户第一版仅支持一个主归属部门。
- 文档系统保留 `faq` 系统键和现有部署入口，不额外创建新系统。
- 文库范围固定为两类：`global` 与 `department`。
- 全局库文档对具备文档系统访问权限的业务用户可直接查看，仅 `admin` 可维护。
- 部门库文档默认仅本部门可查看；跨部门未授权用户只能看到标题、文件名、所属部门和申请入口。
- 跨部门授权粒度固定为“单篇文档”，审批人固定为目标部门的文档管理员。
- 部门管理员不是新角色，而是附加在现有账号上的资格。
- `sysadmin` 只负责组织和账号配置，不具备业务文档正文阅读权限。
- `auditor` 保持审计链路能力，不默认拥有业务文档内容读取权限。

**认证与组织模型**

- `users` 新增 `department_code`，作为用户主归属部门。
- 复用 `juxin_reminder.departments` 作为部门主表。
- 新增 `department_doc_admins`，记录部门文档管理员资格。
- `auth` 的 `/api/auth/introspect` 返回：
  - `scope.department`
  - `scope.managedDepartments`
  - `scope.isDepartmentDocAdmin`

**文档模型**

- `faq_articles` 新增：
  - `library_scope`
  - `department_code`
- `faq_categories` 新增：
  - `library_scope`
  - `department_code`
- 新增：
  - `faq_article_access_requests`
  - `faq_article_access_grants`
  - `faq_article_department_backfill_queue`

**权限规则**

- `admin`
  - 全局可查看与可管理
  - 可创建/修改全局库与部门库文档
  - 可调整文档归属部门和文库范围
- 部门管理员
  - 可管理自己负责部门的分类
  - 可审批其他部门用户对本部门文档的查看申请
  - 可作为部门写作者维护本部门文档
- 普通业务用户
  - 可查看全局库文档
  - 可查看本部门文档
  - 跨部门文档默认仅见题头卡片
- `sysadmin`
  - 不读业务正文
  - 仅在 `auth` 管理后台维护部门和部门管理员

**申请与通知**

- 申请状态：`pending / approved / rejected / revoked / expired`
- 审批时效：`7d / 30d / long_term`
- 申请提交与审批结果都写入 `faq_event_outbox`
- 系统内待办一定可见
- 企业微信/短信走 FAQ 出站事件 + auth 内部通知接口，发送失败不回滚申请主流程

**上线与迁移**

- 历史文档默认按创建人的 `department_code` 回填为部门库。
- 无法归属的历史文档写入 `faq_article_department_backfill_queue`，默认不开放跨部门正文查看。
- 历史分类默认按创建人部门回填；无法归属的分类同样进入人工处理清单。

**验证范围**

- `auth`：部门信息维护、用户部门归属、`introspect` 透传
- `faq backend`：文库范围、权限过滤、申请审批、最小通知落库
- `faq frontend`：全局/部门/受限状态、申请查看、审批队列、分类范围切换
