# Tender 风险中心、模板中心与导出中心设计

## 背景

当前 tender 前端已经具备以下零散能力：

- 仪表盘里有系统级风险提示和待办统计
- 系统配置页里已有投标模板上传与模型配置
- 后端已具备模板字段、模板片段、模板包、投标模板的完整 CRUD
- 项目工作区已经具备解析、初稿、审核、OnlyOffice、版本管理等主链路能力

但 `GAP-0024` 仍未完成，因为产品层缺少 3 个独立的运营中心：

- 风险中心
- 模板中心
- 导出中心

当前问题不是能力缺失，而是能力散落、缺少项目级聚合、缺少导出留痕。

## 目标

在不破坏已通过的项目解析与初稿链路的前提下，补齐 `GAP-0024` 的最小可用闭环：

1. 风险中心可以按项目查看当前风险、阻塞点和推荐动作
2. 模板中心可以集中管理 Word 模板、模板字段、模板片段、模板包
3. 导出中心可以对项目执行 Word/PDF/压缩包导出，并查看导出记录与下载

## 非目标

- 不重做生成引擎和初稿编辑引擎
- 不引入新的 AI 任务类型
- 不改动现有权限模型
- 不重写 `bid-generate` 页面信息架构

## 方案选择

### 方案 A：继续堆到 `dashboard/config/bids`

优点：

- 改动看似最小

缺点：

- 信息架构继续恶化
- 页面职责混乱
- 后续 `GAP-0017/GAP-0026/GAP-0027` 会更难承接

### 方案 B：新增三个独立中心页

优点：

- 与产品稿一致
- 能复用现有接口与数据
- 后续可继续叠加治理、异常、AI 留痕能力

缺点：

- `App.jsx` 仍需新增一批状态和渲染逻辑

### 结论

采用方案 B。新增独立的：

- `risk-center`
- `template-center`
- `export-center`

并保留原有 `audit`、`config`，避免本轮做过度迁移。

## 信息架构

### 风险中心

目标是项目级风险总览，而不是系统日志页。

页面分 3 区：

- 风险概览卡片
  - 高风险项目数
  - 待补资料项目数
  - 待审核项目数
  - 近 7 天导出失败数
- 风险项目列表
  - 项目名称
  - 当前状态
  - 风险等级
  - 风险来源摘要
  - 致命/告警数量
  - 最近解析/校验时间
  - 推荐动作
- 项目快捷操作
  - 打开项目详情
  - 跳到导出中心

风险来源口径：

- 项目状态为 `MATERIALS_PENDING`
- 审核状态卡住
- 最近解析任务失败或有告警
- 最近成稿校验存在 `FATAL/WARN`
- 最近导出失败

### 模板中心

目标是把分散在系统配置中的模板能力提升为可运营页面。

页面分 4 区：

- 投标模板
  - docx 上传
  - 设为默认
  - 删除/停用
- 模板字段
  - 新增字段
  - 启停
  - 默认值维护
- 模板片段
  - 新增片段
  - 分类/标签
  - 内容编辑
  - 启停
- 模板包
  - 新增模板包
  - 选择字段和片段作为 item
  - 启停
  - 查看绑定关系

本轮只做必要能力，不补复杂拖拽排序器，使用基础表单完成绑定。

### 导出中心

目标是把“导出能力”从隐式状态变成独立的产物工作台。

页面分 3 区：

- 导出准备概览
  - 可导出项目数
  - 已导出项目数
  - 最近 7 天导出成功/失败
- 项目导出列表
  - 项目名称
  - 当前状态
  - 当前版本
  - 草稿更新时间
  - 最近导出结果
  - Word/PDF/压缩包导出按钮
- 最近导出记录
  - 导出类型
  - 状态
  - 文件名
  - 大小
  - 操作人
  - 下载

## 后端设计

### 新增表

新增 `tender_bid_export_records`，用于持久化导出产物与状态。

关键字段：

- `bid_id`
- `version_id`
- `draft_id`
- `export_type`：`DOCX / PDF / PACKAGE`
- `status`：`SUCCESS / FAILED`
- `storage_path`
- `file_name`
- `mime_type`
- `file_size`
- `error_message`
- `payload_json`
- `created_by_*`

### 新增接口

#### `GET /api/tender/risk-center/summary`

返回：

- 概览指标
- 项目级风险列表

#### `GET /api/tender/export-center/summary`

返回：

- 导出概览
- 项目列表
- 最近导出记录

#### `POST /api/tender/bids/:id/export`

请求体：

```json
{
  "format": "DOCX"
}
```

支持：

- `DOCX`
- `PDF`
- `PACKAGE`

行为：

- 从当前草稿或当前版本读取源文件
- 生成导出产物
- 写入导出记录
- 成功后将项目推进到 `EXPORTED`（仅当当前状态为 `EXPORT_READY` 时）

#### `GET /api/tender/export-records/:id/download`

用于下载导出记录对应的文件。

### 导出规则

- `DOCX`：复制当前草稿/版本到导出目录
- `PDF`：优先从 docx/draft 转 PDF；若原始版本就是 PDF，则直接复制
- `PACKAGE`：打包包含
  - Word 文件
  - PDF 文件
  - 风险校验报告 txt

风险校验报告复用已有 `buildBidRiskReportText`

## 前端设计

### Tab 调整

主导航新增：

- 风险中心
- 模板中心
- 导出中心

显示规则：

- 风险中心：`canRead`
- 模板中心：`canRead`
- 导出中心：`canRead`

管理动作受已有权限控制：

- 模板写操作：`canTemplateManage`
- 导出操作：`canWrite`

### 状态与数据获取

新增 3 组页面状态：

- `riskCenterState`
- `templateCenterState`
- `exportCenterState`

模板中心额外获取：

- `GET /api/tender/templates/fields`
- `GET /api/tender/templates/snippets`
- `GET /api/tender/templates/bundles`
- `GET /api/tender/doc-templates`

### 交互原则

- 中心页只负责运营动作，不替代项目详情页
- 所有“进入项目”都回到 `bids` 页并打开对应项目
- 模板中心允许读写分离：无管理权限时只读展示
- 导出中心操作后立即刷新中心数据与项目列表

## 测试设计

### 后端

新增 `ops-center.test.js`，覆盖：

- 风险级别与推荐动作聚合
- 风险中心概览聚合
- 导出记录标准化

### 前端

新增 `ops-center.test.js`，覆盖：

- 风险中心数据标准化
- 模板包表单载荷构建
- 导出中心数据标准化与最近记录排序

### 回归

至少执行：

- 后端新增测试
- 前端新增测试
- `node --check tender/backend/src/index.js`
- `npm --prefix tender/frontend run build`

## 验收

满足以下条件即可将 `GAP-0024` 标记为 `DONE`：

- 用户可在独立页面查看项目风险
- 用户可集中管理模板字段、片段、模板包和 docx 模板
- 用户可在独立页面对项目执行 Word/PDF/压缩包导出
- 导出结果有记录、可下载、可追溯
