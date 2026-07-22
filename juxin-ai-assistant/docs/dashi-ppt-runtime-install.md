# Dashi PPT Skill 运行时安装

聚信 AI 助手中的 `dashi-ppt` 是系统通用 Skill。Skill 包负责权限、输入校验、运行记录和下载接口；上游 `chuspeeism/dashi-ppt-skill` 的 `skills/dashi-ppt/project` 目录作为它唯一的 HTML/PPTX/PDF 运行时组件。

## 安装

在 `juxin-ai-assistant` 目录执行：

```bash
bash scripts/install_dashi_ppt_runtime.sh
```

脚本会从上游仓库检出锁定版本 `fdbb145517ea0e289000aef9b7906bcb3e0cd19a`，并在 `.local/dashi-ppt-upstream/skills/dashi-ppt/project` 安装锁定的 npm 依赖。该目录是运行时，不会被复制到 Skill wrapper，也不作为独立产品分发。

然后在 API 进程环境中设置：

```bash
export DASHI_PPT_RUNTIME_ROOT="$PWD/.local/dashi-ppt-upstream/skills/dashi-ppt/project"
```

生产环境应把相同的上游 checkout 挂载到专用目录，并设置同名环境变量；服务器启动时不在线安装依赖。

## 运行时前置条件

运行 API 的机器还需要 Node.js/npm 和可执行的 Chrome/Chromium。导出脚本会自动探测常见路径；如果浏览器安装在自定义位置，可以设置 `CHROME_PATH`。

Docker 预发布使用项目提供的 `docker-compose.ai-assistant-dashi-ppt.yml` 覆盖文件。它会让 API 镜像安装 Node.js、npm、Chromium，并将完整上游 `project`（含其锁定的 `node_modules`）以只读方式挂载到 `/opt/dashi-ppt-runtime`；仅将其中 `output/` 子目录以可写方式回挂，用于 Dashi 导出时生成临时 HTTPS 预览配置。其余运行时代码不会被容器改写。同一 Skill 根目录也会以只读方式挂载，用于在聊天确认中展示官方主题缩略图。生成产物写入独立的持久卷 `/data/ai-assistant/dashi-ppt-exports`：

```bash
export DASHI_PPT_RUNTIME_HOST_PATH="$PWD/.local/dashi-ppt-upstream/skills/dashi-ppt/project"
mkdir -p "$DASHI_PPT_RUNTIME_HOST_PATH/output"
# 如宿主机目录由其他账号创建，确保 API 容器账号可写 output/：
sudo chown -R 1000:1000 "$DASHI_PPT_RUNTIME_HOST_PATH/output"
PYTHON_BASE_IMAGE=python:3.12-slim docker compose --env-file ../.env \
  -f ../docker-compose.yml \
  -f docker-compose.ai-assistant-dashi-ppt.yml \
  build ai-assistant-api

PYTHON_BASE_IMAGE=python:3.12-slim docker compose --env-file ../.env \
  -f ../docker-compose.yml \
  -f docker-compose.ai-assistant-dashi-ppt.yml \
  up -d ai-assistant-api
```

必须在实际运行 Docker 的服务器上执行安装脚本和上述命令。不要把 macOS 或其他操作系统生成的 `node_modules` 复制到服务器：其中可能包含与服务器不兼容的平台二进制。先构建、再启动可以避免初始化服务在 API 本地镜像尚未存在时错误地尝试从镜像仓库拉取它。

默认使用无需私有仓库登录的公开基础镜像 `python:3.12-slim`。如果部署环境需要使用内部镜像，可以显式设置 `PYTHON_BASE_IMAGE`；私有镜像必须先完成对应仓库登录，不能依赖仓库中的默认值隐式切换。

如果使用 HTTPS 全套预发布编排，再追加 `-f docker-compose.ai-assistant-https.yml`。服务器启动时不在线安装依赖。

## 运行结果

普通用户直接在聊天中输入类似“帮我做一份年度经营汇报 PPT”，系统会自动识别并调用 `Dashi PPT 演示文稿制作`，不需要选择助手或手动选择 Skill。生成后可继续在同一聊天输入“把第二页改成风险分析”，系统会基于当前会话上一版演示稿生成新版本并保留旧版本。

能力中心中的 `Dashi PPT 演示文稿制作` 仍保留，供管理员显式测试 Skill。两种入口默认都会生成：

- `presentation-html.zip` HTML 工程包：解压后打开其中的 `index.html`，可离线打开并继续编辑；压缩包根目录同时包含 `index.html`、`assets/`、主题运行时、字体等资源；
- 真实 `.pptx` 文件；
- 需要时可在请求 `input.options.output_format` 中指定 `pdf` 或 `html`，也可以用 `input.formats` 同时生成多种格式。

下载链接只对当前用户和当前运行记录有效。运行时未配置、导出失败或文件不存在时，接口返回明确的 503 错误，不会生成假的下载文件。

历史任务如果只保存了旧版 `ppt/index.html`，下载接口会保留该文件的兼容读取；所有新任务均只交付完整的 `presentation-html.zip`，不再交付无法离线渲染的单独 HTML 文件。

## 使用边界

上游项目按其目录中的 LICENSE 使用：只能作为本 Dashi PPT Skill 的组成部分运行，不得单独提取、复制、再分发或用于其他产品。保留上游目录、许可证和锁文件，不把 `html-deck-to-pptx` 当作聚信 AI 助手的独立导出库。
