# 客户管理：逻辑与实现说明

本文档说明“客户管理”模块的业务逻辑、数据模型、接口与前端实现方式，便于后续维护与扩展。

## 1. 业务目标
客户管理用于维护客户的基础信息，作为联系人、授权、发送计划等模块的基础数据来源。支持增删改查，并保证客户名称唯一。

## 2. 数据模型
### 表：`customers`
字段（在 `server/db.js` 中定义）：
- `id`：自增主键
- `name`：客户名称（唯一，必填）
- `juxin_sales`：聚信销售（可空）
- `channel_sales`：渠道销售（可空）
- `created_at`：创建时间（默认当前时间）

约束：
- `name` 唯一，防止重复客户

## 3. 后端接口设计
文件：`server/index.js`

### 3.1 查询客户列表
- 方法：`GET /api/customers`
- 参数：
  - `search`（可选）：按客户名称模糊搜索
- 返回：客户数组，按 `id` 倒序

### 3.2 新建客户
- 方法：`POST /api/customers`
- Body：
  - `name`（必填）
  - `juxin_sales`（可选）
  - `channel_sales`（可选）
- 逻辑：
  - 校验 `name` 非空
  - 插入数据库
  - 若重名，返回错误

### 3.3 编辑客户
- 方法：`PUT /api/customers/:id`
- Body：同新增
- 逻辑：
  - 校验 `name` 非空
  - 更新对应记录
  - 若重名，返回错误

### 3.4 删除客户
- 方法：`DELETE /api/customers/:id`
- 逻辑：
  - 若该客户下存在联系人，则禁止删除
  - 否则删除记录

## 4. 前端实现方式
文件：`web/src/App.jsx`

### 4.1 状态管理
- `customers`：客户列表
- `customerForm`：新增/编辑表单状态
- `customerSearch`：搜索关键词

### 4.2 数据加载
- `refreshCustomers()` 通过 `/api/customers` 拉取数据
- 搜索时携带 `search` 参数

### 4.3 表单逻辑
- 点击“编辑”时填充 `customerForm`
- 保存时根据 `customerForm.id` 判断是新增还是更新
- 保存成功后刷新列表并清空表单

### 4.4 删除逻辑
- 点击“删除”调用 `DELETE /api/customers/:id`
- 若后端返回“存在联系人”，前端提示并保留数据

## 5. 权限控制
- 后端：
  - 新增/编辑：`admin` / `sales`
  - 删除：`admin`
- 前端：根据 `currentUser.role` 控制按钮显示

## 6. 常见扩展方向
1. 客户列表分页或排序
2. 客户名称拼音/首字母搜索
3. 客户详情页（包含联系人、授权、发送计划）
4. 批量导入（Excel/CSV）

---

如需进一步扩展，我可以补充接口文档或数据字典细节。
