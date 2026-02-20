# Sec-Impl V1 上线检查清单

## 版本信息
- 系统：`sec-impl`
- 发布日期：`2026-02-19`
- 目标分支：`codex/3.0.0`

## 端口与入口
- API：`http://localhost:5185`
- Web：`http://localhost:8084`
- 统一登录：`http://localhost:5180`
- 门户入口变量：`APP_SEC_IMPL_URL=http://localhost:8084`

## 启动命令
```bash
cd /Users/zhanglei/Documents/codex-new
docker compose up --build mysql auth sec-impl-api web-sec-impl
```

## 环境变量核对
- `AUTH_SYSTEM_KEY=sec-impl`
- `MYSQL_DATABASE=juxin_sec_impl`
- `MYSQL_USER=sec_impl_user`
- `MYSQL_PASSWORD=<ENV注入>`
- `MYSQL_ADMIN_USER=root`
- `MYSQL_ADMIN_PASSWORD=<ENV注入>`
- `AUDIT_SIGNING_KEY=<ENV注入>`
- `MAX_BATCH_STAGE_JOB_IDS=200`
- `MAX_IMPORT_ROWS=500`
- `UPLOAD_MAX_FILE_SIZE_MB=10`

## 首日巡检
1. `GET /api/health` 返回 `ok=true`。
2. `GET /api/sec-impl/dashboard/summary` 可返回阶段统计。
3. 新建实施单后可按 `INIT->...->CLOSED` 完整推进。
4. `IMPLEMENT/TUNE/TRIAL/ACCEPT` 阶段推进前，未上传附件会被阻止。
5. `GET /api/sec-impl/audit/verify` 可执行且返回校验结果。
6. Excel 导入模板与导出报表接口可下载。

## 角色矩阵验收命令
```bash
cd /Users/zhanglei/Documents/codex-new/sec-impl/backend
AUTH_BASE=http://localhost:5180 API_BASE=http://localhost:5185 npm run test:rbac
```

## 冒烟与回归命令
```bash
cd /Users/zhanglei/Documents/codex-new/sec-impl/backend
AUTH_TOKEN=<TOKEN> API_BASE=http://localhost:5185 npm run test:smoke
AUTH_TOKEN=<TOKEN> API_BASE=http://localhost:5185 npm run test:regression
```

## 回滚预案
1. 停止 sec-impl 服务：
```bash
docker compose stop sec-impl-api web-sec-impl
```
2. 回退到上一个稳定镜像或提交后重启：
```bash
docker compose up -d --build sec-impl-api web-sec-impl
```
3. 如需回退数据，仅回滚 `juxin_sec_impl` 库，不影响其他业务库。
4. 回滚后重新执行：`GET /api/health`、`GET /api/sec-impl/audit/verify`、RBAC 脚本。
