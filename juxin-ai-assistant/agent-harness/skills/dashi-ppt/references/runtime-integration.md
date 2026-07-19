# Dashi 运行时接入说明

聚信通过固定适配器调用独立部署的 Dashi PPT Skill 运行时，接收真实 HTML/PPTX/PDF 产物。API 只执行固定的 npm 脚本，不执行用户提供的 Shell 命令。

## 必须满足的条件

1. 使用上游 Skill 原样的运行时版本，并把许可证文件与构建产物一起归档。该导出组件仅作为 Dashi PPT Skill 的组成部分使用，不得单独提取、复制、再分发或用于其他产品/服务。
2. Worker 只接收结构化 `goal.json` 和已校验的相对素材路径；禁止传入任意 Shell 字符串。
3. npm 依赖使用锁文件和内部镜像，生产任务禁止在线安装依赖。
4. 预览服务绑定 `127.0.0.1` 或受控容器网络；不把预览端口暴露到公网。
5. PPTX/PDF 导出结果写入任务隔离目录，经过病毒扫描和大小限制后再交给用户。
6. 通过 `DASHI_PPT_RUNTIME_ROOT` 指向上游 `project` 目录；运行器生成受校验的 `goal.json`，按固定顺序调用 `render:goal`、`export:pptx` 和 `export:pdf`，并为 Skill 运行记录成果。

## 当前系统行为

未设置 `DASHI_PPT_RUNTIME_ROOT` 或运行时目录不完整时，`dashi-ppt` 返回 `DASHI_PPT_RUNTIME_UNAVAILABLE`，不能伪造下载地址或成功状态。部署人员应在运行环境中预装锁定依赖，服务器本身不在线安装上游依赖。
