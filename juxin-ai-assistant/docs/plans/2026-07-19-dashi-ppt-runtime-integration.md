# Dashi PPT 直接生成运行时接入

## 目标

把已登记的 `dashi-ppt` Skill 从“目录/说明接入”推进到可验证的 PPTX/PDF 产物链路：用户提交问题和可选的结构化演示稿计划，服务端在独立的上游 Dashi Skill 运行时中生成文件，并提供有权限校验的下载地址。

## 范围

- 增加显式运行时配置和固定的 subprocess 适配器；不把上游专有导出组件复制进本仓库，运行时保留为 Dashi Skill 的集成组件。
- 运行前校验运行时根目录、输入文件、输出目录和产物大小；禁止任意用户命令、远程 URL 和任意路径。
- 在 Skill 运行响应中返回真实 PPTX/PDF/HTML 产物及下载地址；下载按运行记录和当前用户校验归属。
- 为未配置运行时提供 fail-closed 的可读错误，并保留运行日志。
- 桌面端 Skill 页面显示可下载产物；补充后端单元测试和前端类型检查。

## 候选文件

- `server/app/config.py`
- `server/app/dashi_ppt_runtime.py`（新增）
- `server/app/skill_runner.py`
- `server/app/skill_routes.py`
- `server/app/main.py`
- `apps/desktop/src/api/client.ts`
- `apps/desktop/src/pages/SkillsPage.tsx`
- `server/tests/test_dashi_ppt_runtime.py`（新增）
- `server/tests/test_skills.py`

## 实施步骤

1. 读取上游导出脚本的固定接口，设计只接受受控运行时根目录和结构化计划的适配器。
2. 实现运行时检查、输入落盘、PPTX/PDF/HTML 导出和产物元数据；限制超时、大小和路径穿越。
3. 接入 `SkillRunner` 与下载路由，记录失败原因并保证无运行时时不伪造文件。
4. 更新 Skill manifest、API 类型和页面下载入口。
5. 运行针对性测试、类型检查和 `git diff --check`；将结果写入当天 memory。

## 验证命令

```bash
PYTHONPATH=server python3 -m pytest -q server/tests/test_dashi_ppt_runtime.py server/tests/test_skills.py
cd apps/desktop && npm run typecheck
git diff --check
```

## 未完成/边界

- 真实 PPTX/PDF 导出要求部署方在 `DASHI_PPT_RUNTIME_ROOT` 指向未修改的上游运行时目录；本仓库不携带、复制或单独分发专有导出器。部署方仍需遵守上游许可证及其运行环境要求。
- 生产环境的运行时目录、Node/浏览器依赖和容量监控需要在预发布机完成一次演练后再启用。
