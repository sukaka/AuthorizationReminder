# 授权到期提醒前端（web）

目录：`/Users/zhanglei/Documents/codex-new/web`

## 1. 功能定位
- 提醒系统前端页面（客户、联系人、授权、发送、日志、安全配置）。
- 复用统一登录（SSO）会话与授权。
- 审计日志页面显示来源 IP 与中文“变更摘要”（不直接展示原始 JSON）。

## 2. 开发启动
```bash
cd /Users/zhanglei/Documents/codex-new/web
npm install
npm run dev
```

默认开发地址：`http://localhost:5173`  
通过 Vite 代理到：
- `http://localhost:5180`（`/api/auth`）
- `http://localhost:5179`（业务 API 与上传）

## 3. 构建与预览
```bash
cd /Users/zhanglei/Documents/codex-new/web
npm run build
npm run preview
```

## 4. Docker 运行
在仓库根目录执行：
```bash
cd /Users/zhanglei/Documents/codex-new
docker compose up --build mysql auth api web
```

对外地址：`http://localhost:18080`

## 5. 登录与会话说明
- 登录页密码框支持“眼睛”按钮切换明文/密文。
- 登录成功后依赖统一登录 Cookie。
- Cookie 为浏览器会话级，关闭浏览器后再次访问需重新登录。

## 6. 相关文档
- 需求：`/Users/zhanglei/Documents/codex-new/docs/requirements/reminder-requirements.md`
- 手册：`/Users/zhanglei/Documents/codex-new/docs/manuals/reminder-user-manual.md`
- 测试用例：`/Users/zhanglei/Documents/codex-new/docs/testcases/reminder-test-cases.md`
