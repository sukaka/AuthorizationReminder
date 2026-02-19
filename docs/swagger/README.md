# Swagger / OpenAPI 文档总览

以下是四个系统的 OpenAPI 3.0 文档（Swagger 兼容）：

- 提醒系统：`/Users/zhanglei/Documents/codex-new/server/api/openapi/reminder-v1.yaml`
- 工单系统：`/Users/zhanglei/Documents/codex-new/ticketing/api/openapi/ticketing-v1.yaml`
- CMDB 系统：`/Users/zhanglei/Documents/codex-new/cmdb/api/openapi/cmdb-v1.yaml`
- 库存系统：`/Users/zhanglei/Documents/codex-new/inventory-system/backend/api/openapi/inventory-v1.yaml`

## 使用方式

可直接将上述 YAML 导入 Swagger Editor：

1. 打开 [https://editor.swagger.io](https://editor.swagger.io)
2. 选择 `File -> Import File`
3. 导入对应系统的 `.yaml` 文件

## 说明

- 文档基于当前代码路由生成/整理，覆盖四个系统现有 API 路径。
- 认证方式统一为 `Bearer JWT`（公开接口已在文档中标记为无需鉴权）。
- 上传类接口（如附件上传、导入、截图上传）已标记为 `multipart/form-data`。
