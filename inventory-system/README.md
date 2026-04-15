# 聚信库存管理系统

库存系统目录：`/Users/zhanglei/Documents/codex-new/inventory-system`

## 功能清单（MVP）
- 商品管理：SKU、分类、单位、安全库存、启停
- 商品存放位置：仓库/库区/货架/库位
- 商品使用位置：部门/项目/门店等领用去向
- 入库：按商品+存放位置入账
- 出库：按商品+存放位置出账，并记录使用位置
- 批次与序列号：支持按 `批次号`、`SN` 全链路追溯（入库、在库、出库）
- 发货管理：关联出库单、支持拆包多单号、物流状态流转、轨迹查询、发货单打印
- 盘点：录入实盘数量后自动做差异调整
- 库存台账：实时库存（含低库存预警）
- 流水明细：IN / OUT / ADJUST 全链路记录

## 发货与物流（新增）
- 状态流转：`待发货 -> 已发货 -> 运输中 -> 已签收 / 异常`
- 出库列表增强：发货状态、快递单号、去发货
- 发货超时预警：待发货超时 / 运输超时，自动写入提醒联动表
- 物流轨迹：支持库存内轨迹 + 可选第三方轨迹接口拉取
- 实时刷新：轨迹弹窗支持自动刷新（默认 30 秒）
- 自动同步：后端可按周期自动同步在途物流轨迹
- 发货编辑：弹窗编辑（可拖拽）
- 打印模板：发货清单 + 轨迹打印

说明：
- 含批次/SN的入库单当前不支持在线编辑，建议作废后重建，避免追溯链路被破坏。

## 菜鸟 / 顺丰 / 京东物流接入（统一网关）
当前方案新增 `shipping-gateway` 服务，库存后端只连一个入口：
- `SHIPPING_TRACKING_API_URL=http://shipping-gateway:5190/api/track/query`
- `SHIPPING_TRACKING_API_TOKEN=inventory-shipping-gateway-dev-token`
- `SHIPPING_TRACKING_API_TIMEOUT_MS=8000`

网关会根据 `物流公司` 字段自动识别并路由到：
- 菜鸟：`CAINIAO_TRACKING_API_URL`、`CAINIAO_TRACKING_API_TOKEN`
- 顺丰：`SF_TRACKING_API_URL`、`SF_TRACKING_API_TOKEN`
- 京东：`JD_TRACKING_API_URL`、`JD_TRACKING_API_TOKEN`

说明：
- `*_TRACKING_API_URL` 可以填你们企业自建的对接代理地址，或各平台开放接口地址。
- 如直连开放平台，通常还需要补充平台密钥（如 `APP_KEY/APP_SECRET`、`CUSTOMER_CODE/CHECKWORD`），对应变量在 `inventory-system/shipping-gateway/.env.example`。
- 未配置某家物流时，网关会返回“未配置”提示，不影响库存出入库主流程。

## 数据库策略
- 与提醒系统使用同一个 MySQL 实例
- 新建独立数据库：`juxin_inventory`
- 与提醒库 `juxin_reminder` 物理隔离（不同 schema）

库存后端启动时会自动：
1. 创建数据库 `juxin_inventory`（若不存在）
2. 给业务账号授权
3. 初始化库存业务表结构（不创建本地账号）

## 统一登录
- 不使用本地账号体系
- 登录入口与提醒/工单一致，统一走聚信登录门户：`http://localhost:5180/portal`
- 库存系统通过 SSO Token 调用 `auth` 服务校验身份与权限
- 用户是否可见“库存系统”由统一登录中的 `app_access` 控制（`inventory`）

## 本地开发启动
前置：需要先启动统一登录服务 `auth`（默认 `http://localhost:5180`）。

### 1) 启动后端
```bash
cd /Users/zhanglei/Documents/codex-new/inventory-system/backend
cp .env.example .env
npm install
npm run dev
```

### 2) 启动前端
```bash
cd /Users/zhanglei/Documents/codex-new/inventory-system/frontend
npm install
npm run dev
```

访问：`http://localhost:18082`

## Docker 启动（接入主工程同一 MySQL）
已在主目录 `docker-compose.yml` 中新增：
- `inventory-api`（端口 `5183`）
- `web-inventory`（端口 `8082`）
- `shipping-gateway`（端口 `5190`）

启动：
```bash
cd /Users/zhanglei/Documents/codex-new
docker compose up --build mysql auth api web ticketing web-ticketing inventory-api web-inventory
```

仅启动库存：
```bash
docker compose up --build mysql auth inventory-api web-inventory
```

## 目录结构
```text
inventory-system/
  backend/
    src/
      db.js
      index.js
    .env.example
    Dockerfile
    package.json
  frontend/
    src/
      App.jsx
      App.css
      main.jsx
      index.css
    index.html
    vite.config.js
    nginx.conf
    Dockerfile
    package.json
  shipping-gateway/
    src/
      index.js
    .env.example
    Dockerfile
    package.json
```
