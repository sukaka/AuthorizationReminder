# 聚信 AI 助手桌面端 Design System

## 1. Atmosphere & Identity

这是一个安静、可信、克制的企业工作台。界面像 macOS 原生工具而不是营销网站：信息层级清晰，操作有明确反馈，错误状态始终可恢复。视觉签名是“雾白工作台 + 精确蓝色动作 + 低饱和状态色”，让本地安全能力和远程工作台看起来属于同一个产品。

## 2. Color

### Palette

| Role | Token | Light | Dark | Usage |
| --- | --- | --- | --- | --- |
| Canvas | `--background` | `#f3f4f6` | `#17181a` | 应用背景 |
| Surface/translucent | `--surface` | `rgb(255 255 255 / 78%)` | `rgb(39 40 43 / 80%)` | 侧栏、次级面板 |
| Surface/solid | `--surface-solid` | `#ffffff` | `#27282b` | 表单、卡片 |
| Surface/elevated | `--surface-elevated` | `#ffffff` | `#2e2f33` | 弹窗、浮层 |
| Text/primary | `--text-primary` | `#17181a` | `#f5f5f7` | 标题、正文 |
| Text/secondary | `--text-secondary` | `#6c7078` | `#a8abb2` | 说明、元信息 |
| Border | `--border` | `rgb(60 60 67 / 14%)` | `rgb(235 235 245 / 14%)` | 分隔线、输入框 |
| Action | `--accent` | `#007aff` | `#0a84ff` | 主操作、焦点 |
| Action/strong | `--accent-strong` | `#0066cc` | `#0066cc` | 主按钮默认状态 |
| Action/text | `--accent-text` | `#0066cc` | `#409cff` | 链接和强调文字 |
| Action/soft | `--accent-soft` | `#e8f2ff` | `#173652` | 选中和信息提示 |
| Status/success | `--success` | `#248a3d` | `#30d158` | 连接成功、同步完成 |
| Status/success text | `--success-text` | `#1f7a35` | `#30d158` | 成功状态文字 |
| Status/warning | `--warning` | `#b25000` | `#ff9f0a` | 更新提示、需确认 |
| Status/error | `--danger` | `#ff3b30` | `#ff453a` | 连接失败、危险操作 |
| Status/error text | `--danger-text` | `#d70015` | `#ff6961` | 错误状态文字 |
| Modal backdrop | `--modal-backdrop` | `rgb(23 24 26 / 28%)` | `rgb(0 0 0 / 58%)` | 模态弹窗遮罩 |
| Sidebar | `--sidebar` | `rgb(236 238 242 / 82%)` | `rgb(30 31 34 / 88%)` | 工作台导航 |

### Rules

- 蓝色只用于操作、选择和信息状态，不作为大面积装饰。
- 连接和更新状态必须同时使用文字与图形，不只依赖颜色。
- 新颜色必须先加入本表和 `tokens.css`。

## 3. Typography

### Scale

| Level | Size | Weight | Line Height | Tracking | Usage |
| --- | --- | --- | --- | --- | --- |
| Display | `36px` | `700` | `1.12` | `-0.04em` | 启动页主标题 |
| H1 | `32px` | `700` | `1.18` | `-0.04em` | 工作台页标题 |
| H2 | `24px` | `650` | `1.25` | `-0.025em` | 卡片组标题 |
| H3 | `18px` | `650` | `1.35` | `-0.015em` | 面板标题 |
| Body/lg | `17px` | `400` | `1.6` | `0` | 产品简介 |
| Body | `15px` | `400` | `1.55` | `0` | 默认正文 |
| Body/sm | `13px` | `400` | `1.5` | `0` | 辅助说明 |
| Caption | `12px` | `500` | `1.4` | `0.01em` | 状态和版本 |
| Overline | `11px` | `650` | `1.3` | `0.08em` | 分组标签 |

### Font Stack

- Display: `"SF Pro Display", "PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- Text: `"SF Pro Text", "PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- Mono: `"SF Mono", "Cascadia Code", monospace`

### Rules

- 正文不得小于 13px，关键说明不得小于 15px。
- 标题使用紧凑字距，长正文保持至少 1.5 行高。
- 不加载远程字体，保证离线启动页立即可读。

## 4. Spacing & Layout

### Base Unit

所有间距基于 4px。

| Token | Value | Usage |
| --- | --- | --- |
| `--space-1` | `4px` | 图标内距 |
| `--space-2` | `8px` | 紧凑控件 |
| `--space-3` | `12px` | 输入框和小组间距 |
| `--space-4` | `16px` | 标准控件间距 |
| `--space-5` | `20px` | 面板内部组距 |
| `--space-6` | `24px` | 卡片内距 |
| `--space-8` | `32px` | 区块间距 |
| `--space-10` | `40px` | 大区块间距 |
| `--space-12` | `48px` | 页面边距 |
| `--space-16` | `64px` | 主视觉留白 |

### Grid

- 桌面最大内容宽度：`1120px`。
- 启动页：`5 / 7` 双栏，间距 `32px`；宽度低于 `860px` 时改为单栏。
- 工作台：`232px` 导航 + 自适应内容。
- 最小窗口：`900 × 640`；内容在窄窗口内不得横向滚动。

## 5. Components

### Primary Button

- **Structure:** 原生 `<button>`，文本与可选加载状态。
- **Variants:** primary、secondary、quiet、danger。
- **Spacing:** 高度 `44px`，水平内距 `20px`。
- **States:** default、hover、active、focus、disabled、loading。
- **Accessibility:** 可见焦点；disabled 使用原生属性；加载时保留按钮宽度。
- **Motion:** `120ms` 的颜色和 `transform` 反馈。

### Status Notice

- **Structure:** 状态图标、标题、说明、可选恢复操作。
- **Variants:** info、success、warning、error。
- **Spacing:** `16px` 内距，元素间 `8px`。
- **Accessibility:** `role="status"` 用于非阻断变化，`role="alert"` 用于失败。
- **Motion:** 仅淡入；遵循 reduced motion。

### Address Field

- **Structure:** `<label>`、输入框、连接状态、说明。
- **States:** empty、invalid、checking、ready、error、disabled。
- **Accessibility:** 错误通过 `aria-describedby` 关联；测试连接和登录可用性不只依赖颜色。

### Update Dialog

- **Structure:** 原生 dialog 语义、版本、说明、大小、进度和操作。
- **States:** available、downloading、installing、failed。
- **Accessibility:** 打开时聚焦标题/首个操作，关闭后返回触发按钮。

## 6. Motion & Interaction

| Type | Duration | Easing | Usage |
| --- | --- | --- | --- |
| Micro | `120ms` | `ease-out` | 按钮、输入框状态 |
| Standard | `200ms` | `ease-in-out` | 状态面板、弹窗 |
| Emphasis | `420ms` | `cubic-bezier(0.16, 1, 0.3, 1)` | 启动页首次出现 |

- 只动画 `transform`、`opacity` 和颜色。
- 所有按钮和输入框必须有 hover、active、focus-visible、disabled。
- `prefers-reduced-motion: reduce` 时关闭非必要动画。
- 连接检查和更新安装期间不得用无限无说明动画；必须配合状态文字。

## 7. Depth & Surface

采用 **mixed but restrained**：

- 普通结构主要依赖 tonal shift 和 1px 边框。
- 只有启动页主卡片和弹窗使用 `--shadow` 的低透明度扩散阴影。
- 禁止多层重阴影、霓虹、强渐变和大面积玻璃拟态。
- 圆角层级：输入/按钮 `10px`，普通卡片 `14px`，主面板 `20px`，状态胶囊仅用于短文本。
