# 聚信 FAQ 系统

目录：`/Users/zhanglei/Documents/codex-new/faq`

## 范围
- 独立系统、独立目录
- 复用统一登录（auth），系统键：`faq`
- 复用现有 MySQL 实例，独立库：`juxin_faq`
- 服务端口：API `5186`，前端 `8085`
- 文档编辑：OnlyOffice（内置容器）

## 核心能力
- FAQ 分类管理、文章管理、版本管理
- 上传 `doc/docx/pdf`
- 在线预览（docx 转 html，pdf 内嵌）
- 原始 Word 在线编辑（OnlyOffice）
- 编辑锁机制（支持分段协作锁，超时自动释放）
- 自动保存草稿 + 手动发布
- 发布前校验、审批发布、发布版本回滚
- 收藏、反馈闭环、阅读统计、智能置顶建议
- 内容健康度、热门与趋势、审计日志、事件出站队列
- 回收站与自动清理、搜索文本重建

## 权限模型
- 读权限：`app_access` 包含 `faq`
- `admin`：全量管理能力（含置顶、批量、回收站维护）
- `editor`：FAQ 写入能力（创建、上传、在线编辑）
- `reviewer`：发布审批与直接发布能力
- `auditor`：审计日志与事件出站查看

## Docker 启动
```bash
cd /Users/zhanglei/Documents/codex-new
docker compose up -d --build mysql auth onlyoffice faq-api web-faq
```

访问：`http://localhost:8085`

## 本地开发
后端：
```bash
cd /Users/zhanglei/Documents/codex-new/faq/backend
npm install
npm run dev
```

前端：
```bash
cd /Users/zhanglei/Documents/codex-new/faq/frontend
npm install
npm run dev
```

## 关键环境变量
- `AUTH_SYSTEM_KEY=faq`
- `MYSQL_DATABASE=juxin_faq`
- `DOC_EDITOR_PROVIDER=onlyoffice`
- `DOC_EDITOR_FILE_BASE_URL=http://faq-api:5186`
- `DOC_EDITOR_CALLBACK_BASE_URL=http://faq-api:5186`
- `DOC_EDITOR_JWT_SECRET=<strong-random-key>`
- `UPLOAD_MAX_FILE_SIZE_MB=20`
- `EDITOR_LOCK_MINUTES=20`

## 测试
```bash
cd /Users/zhanglei/Documents/codex-new/faq/backend
npm run test:smoke
```
