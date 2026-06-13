# Unified Big-Screen Center

统一大屏展示中心聚合 SCA、培训考试和授权提醒数据，提供 12 套双布局模板、受限编辑、播放列表、离线地图和故障降级。

## Components

- `backend/`: Express BFF、统一鉴权、数据适配、模板/播放列表、健康与资源包接口。
- `frontend/`: Vue 3 播放器、模板目录、GridStack 编辑器、Three.js/ECharts/G6/MapLibre 动效。
- `assets/`: 生产离线地图、GeoJSON、字体、纹理和模型的唯一受信目录。
- `deploy/verify-offline-assets.mjs`: 校验远程 URL、目录穿越、缺失文件和逃逸符号链接。

## Development

```bash
npm --prefix big-screen-center/backend install
npm --prefix big-screen-center/frontend install
npm --prefix big-screen-center/backend run dev
npm --prefix big-screen-center/frontend run dev
```

后端默认监听 `5192`，前端开发服务默认监听 `5173`。生产入口由 Compose 暴露为 `http://localhost:18092`。

## 模板交互

- 悬停指标可预览同模板关联数据，点击后锁定并打开底部分析台。
- 点击其他指标切换锁定，点击空白、关闭按钮或按 Esc 清除。
- “前往业务系统”只打开白名单内路径，并过滤敏感查询参数。
- `VITE_SCA_APP_URL`、`VITE_TRAIN_EXAM_APP_URL`、`VITE_REMINDER_APP_URL` 可覆盖三个业务系统前端地址。

## Operations

- `GET /api/big-screen/health`: 数据库及 `sca`、`train-exam`、`reminder` 来源健康状态。
- `POST /api/big-screen/resources/packs`: `sysadmin` 上传 Ed25519 签名资源包清单。
- `POST /api/big-screen/resources/packs/:key/:version/enable`: 启用指定资源包版本。
- `POST /api/big-screen/resources/packs/:key/:version/rollback`: 回滚到指定资源包版本。

资源包使用 `BIG_SCREEN_RESOURCE_PUBLIC_KEY` 验签，并逐文件核对 SHA-256。文件必须位于 `assets/`，绝对路径、`..` 和符号链接会被拒绝。

联网增强默认关闭。仅 `BIG_SCREEN_EXTERNAL_ORIGIN_ALLOWLIST` 中的 HTTPS origin 可被配置使用；离线地图始终保留本地回退。

```bash
node big-screen-center/deploy/verify-offline-assets.mjs
npm --prefix big-screen-center/backend run test:run
npm --prefix big-screen-center/frontend run test:run
```

`@kjgl77/datav-vue3` 在 Vue 3.5 下使用兼容降级框体，避免运行时插槽异常；核心指标、数据状态和生成时间不受视觉插件故障影响。
