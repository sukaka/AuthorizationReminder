# Dashi PPT 第三方声明

## 来源

- 项目：[chuspeeism/dashi-ppt-skill](https://github.com/chuspeeism/dashi-ppt-skill)
- 审计提交：`fdbb145517ea0e289000aef9b7906bcb3e0cd19a`
- 上游版本：`0.4.4`
- 上游主体许可证：GNU Affero General Public License v3.0（AGPL-3.0）

## 重要授权边界

上游明确声明 `project/packages/html-deck-to-pptx` 为专有导出组件，只能作为该 Skill 的组成部分使用，不得单独提取、复制、再分发或用于其他软件、产品或服务。该组件作为 Dashi PPT Skill 的组成部分使用，不再以“必须另行取得授权”作为运行前置条件。

聚信 AI 助手不复制该目录，也不自动安装上游 npm 依赖；部署人员应通过 `DASHI_PPT_RUNTIME_ROOT` 指向原样保留许可证和锁定依赖的独立运行时，并确保运行时只服务于本 Dashi PPT Skill。

## 安全审计结论（2026-07-19）

- 未发现读取 `~/.ssh`、`~/.aws`、`.env` 或凭据文件的指令。
- 未发现 `curl`、`wget`、`nc`、反向 Shell、关闭沙箱或提权指令。
- 上游脚本会写入本地生成目录、启动本地预览进程，并可能检查 npm registry；这些行为不在聚信服务器端自动执行。
- 本仓库只保留 Skill 契约和流程适配，不把上游 57 MB 运行时直接并入主服务。
