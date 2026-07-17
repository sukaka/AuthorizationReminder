# 聚信 AI 助手 4.0 独立交互原型

这个原型用于评审 4.0 的产品方向。它不加载现有桌面端、统一门户、登录状态或后端 API，也不会写入正式成果。

## 启动

```bash
cd /Users/zhanglei/Documents/codex-new/juxin-ai-assistant/prototypes/ai-assistant-4.0
npm run dev
```

浏览器打开 <http://localhost:18140/>。

## 验证

```bash
npm test
npm run check
```

## 视觉规则

- 原型配色直接对齐 `apps/desktop/src/theme/tokens.css` 的现有浅色主题：灰白背景、白色表面、深色正文和蓝色主操作。
- 成功、警告和阻断分别使用现有系统的绿、橙、红语义色；不维护第二套品牌颜色。
- 配色令牌复制在原型本地，保证桌面端未启动时仍能独立评审，不形成运行时依赖。

## 原型边界

- 演示内容块编辑、拖拽、键盘排序、自动保存状态、审核、评论、版本和 Office 边界。
- 所有数据都在浏览器内存中；刷新页面恢复为内置演示数据。
- 不代表正式编辑器内核已经选型，不包含真实上传、导入、导出、协作或后端恢复能力。
