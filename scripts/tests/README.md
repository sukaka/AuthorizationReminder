# 一键测试脚本

目录：`/Users/zhanglei/Documents/codex-new/scripts/tests`

## 脚本清单

- `auth.sh`：统一登录（SSO）
- `reminder.sh`：授权到期提醒
- `ticketing.sh`：工单系统
- `inventory.sh`：库存系统
- `device-flow.sh`：设备流转
- `sec-impl.sh`：实施记录
- `faq.sh`：FAQ 系统
- `tender.sh`：标书系统
- `train-exam.sh`：培训考试系统
- `cmdb.sh`：CMDB
- `run-all.sh`：一键跑全部系统

## 直接使用

```bash
cd /Users/zhanglei/Documents/codex-new

# 跑单个系统
bash scripts/tests/auth.sh
bash scripts/tests/reminder.sh
bash scripts/tests/ticketing.sh
bash scripts/tests/inventory.sh
bash scripts/tests/device-flow.sh
bash scripts/tests/sec-impl.sh
bash scripts/tests/faq.sh
bash scripts/tests/tender.sh
bash scripts/tests/train-exam.sh
bash scripts/tests/cmdb.sh

# 一键跑全部
bash scripts/tests/run-all.sh

# 一键跑指定系统（示例）
bash scripts/tests/run-all.sh reminder tender train-exam cmdb
```

## 常用环境变量

- `COMPOSE_BUILD=1|0`
  - 默认 `1`，执行脚本时会 `docker compose up -d --build`
  - 设为 `0` 可跳过 build，仅 `up -d`
- `SKIP_COMPOSE_UP=1`
  - 跳过容器启动，直接对当前已运行环境做检查
- `AUTH_BASE`
  - 默认 `http://localhost:5180`
- `AUTH_TOKEN`
  - 某些深度接口测试可直接复用你已登录得到的 Bearer Token

## 深度测试控制（device-flow / sec-impl）

- `RUN_E2E=1|0`
  - 默认 `1`，会执行 smoke/regression 脚本
- `RUN_RBAC=1|0`
  - 默认 `1`，会执行 RBAC 矩阵脚本

示例：

```bash
RUN_E2E=1 RUN_RBAC=0 bash scripts/tests/device-flow.sh
RUN_E2E=1 RUN_RBAC=1 bash scripts/tests/sec-impl.sh
```

## MFA 强制场景说明

如果系统开启了“强制全员 MFA”且测试账号未完成二次验证配置，自动登录取 token 会失败。
这时请先手工登录完成 MFA 配置，然后：

```bash
export AUTH_TOKEN='<你的BearerToken>'
bash scripts/tests/tender.sh
```

`device-flow` / `sec-impl` 的 RBAC 脚本需要多账号 token，也可分别传入：

- `AUTH_TOKEN_ADMIN`
- `AUTH_TOKEN_AUDITOR`
- `AUTH_TOKEN_SYSADMIN`
