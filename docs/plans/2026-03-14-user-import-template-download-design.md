# 用户导入模板下载设计

## 背景

提醒系统的用户管理已经支持 Excel 批量导入，入口位于 [web/src/App.jsx](/Users/zhanglei/Documents/codex-new/web/src/App.jsx)，后端导入逻辑位于 [server/index.js](/Users/zhanglei/Documents/codex-new/server/index.js) 和 [server/user-import.js](/Users/zhanglei/Documents/codex-new/server/user-import.js)。

当前缺口是：管理员虽然能看到导入字段说明，但还没有“一键下载模板”的入口。对真实使用者来说，字段名和填写格式最容易在第一次导入时出错，尤其是：

- `role` 的合法值
- `is_active` 的填写口径
- `app_access` 的分隔符写法
- 可选列和必填列的边界

因此需要补一个最小、稳定、可长期维护的模板下载能力。

## 已确认需求

- 方案选择：后端生成模板并下载
- 下载入口放在现有“用户管理”导入区旁边
- 模板格式仍为 Excel
- 模板应包含真实导入所需列名
- 模板中带一行示例数据，方便直接照着改

## 非目标

- 不做模板上传
- 不做多工作表复杂说明页
- 不做 CSV 模板
- 不做字段字典接口
- 不做独立静态模板文件落库或长期存储

## 方案对比

### 方案 A：前端本地生成 Excel 模板

- 优点：少一个接口
- 缺点：`web` 侧没有现成 `xlsx` 生成能力；如果前端自己维护列定义，后续容易和后端导入规则漂移

结论：不采用。

### 方案 B：后端生成并返回模板 Excel

- 优点：可直接复用 [server/user-import.js](/Users/zhanglei/Documents/codex-new/server/user-import.js) 已经在使用的 `xlsx` 依赖
- 优点：模板列和示例值可与真实导入逻辑放在同一侧维护，不容易失真
- 优点：前端只需要一个下载按钮和 `blob` 下载动作，改动最小

结论：采用。

### 方案 C：仓库放一个静态模板文件供下载

- 优点：实现最快
- 缺点：字段一旦变更，最容易忘记同步；长期维护成本反而更差

结论：不采用。

## 目标体验

在 [web/src/App.jsx](/Users/zhanglei/Documents/codex-new/web/src/App.jsx) 的“用户管理”导入区中，保留现有“批量导入（Excel）”按钮，并新增一个“下载模板”按钮。

管理员点击“下载模板”后：

1. 前端调用新的模板下载接口
2. 浏览器直接下载模板 Excel
3. 文件名清晰可识别，例如 `user-import-template.xlsx`

不新增弹窗，不新增中间页，不要求额外确认。

## 模板内容设计

### 工作表

- 单工作表
- Sheet 名称：`template`

### 列

模板第一行使用真实导入列名：

- `username`
- `role`
- `is_active`
- `app_access`
- `email`
- `phone`
- `wecom_id`

### 示例行

第二行提供一条可直接参考的示例：

- `username`: `editor_demo`
- `role`: `editor`
- `is_active`: `1`
- `app_access`: `faq|tender`
- `email`: `editor_demo@example.com`
- `phone`: `13800000000`
- `wecom_id`: `editor-demo`

### 字段口径

- `role` 仍使用后端现有角色值：`admin`、`editor`、`sysadmin`、`auditor`、`user`、`viewer`、`sales`
- `is_active` 推荐写 `1` 或 `0`
- `app_access` 推荐写 `faq|tender|train-exam`

这轮不把角色枚举、系统枚举拆成第二张说明 sheet，避免过度设计；页面已有辅助文案即可承接说明。

## 后端设计

### 新增接口

- `GET /api/import/users/template.xlsx`

### 权限

- 沿用 `requireRole(['sysadmin'])`

### 返回方式

- `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- `Content-Disposition: attachment; filename="user-import-template.xlsx"`

### 实现位置

建议把模板 workbook 的生成逻辑放到 [server/user-import.js](/Users/zhanglei/Documents/codex-new/server/user-import.js)，不要直接把列数组硬编码在 route 里。这样模板列与导入 helper 更靠近，后续维护时更容易一起改。

## 前端设计

前端在 [web/src/App.jsx](/Users/zhanglei/Documents/codex-new/web/src/App.jsx) 的用户导入区增加一个轻量下载动作：

- 发起 `fetch('/api/import/users/template.xlsx')`
- 读 `blob`
- 使用浏览器下载

如果需要，前端 helper [web/src/user-import.js](/Users/zhanglei/Documents/codex-new/web/src/user-import.js) 可以顺手新增模板文件名解析或通用下载函数；但这轮应避免把 helper 过度抽象成通用文件下载框架。

## 安全与维护

- 模板本身不包含任何敏感信息
- 不需要写入 `import_jobs`
- 不需要写操作日志 `CREATE/UPDATE/DELETE`
- 仅系统管理员可下载，和用户导入权限保持一致

## 测试策略

### 后端

新增或扩展 [server/tests/user-import.test.js](/Users/zhanglei/Documents/codex-new/server/tests/user-import.test.js)：

- 断言模板 workbook 可生成
- 断言 sheet 名为 `template`
- 断言表头完整
- 断言示例行存在且 `app_access` 示例为 `faq|tender`

### 前端

如果新增前端 helper：

- 验证模板文件名默认值
- 验证下载动作的最小行为

### 回归验证

- `node --test server/tests/user-import.test.js`
- `node --test web/src/user-import.test.js`
- `node --check server/index.js`
- `npm --prefix web run build`

## 预期改动文件

- `server/user-import.js`
- `server/tests/user-import.test.js`
- `server/index.js`
- `server/api/openapi/reminder-v1.yaml`
- `web/src/App.jsx`
- `web/src/user-import.js`
- `docs/manuals/reminder-user-manual.md`
