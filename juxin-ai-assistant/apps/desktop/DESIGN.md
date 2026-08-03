# 聚信 AI 助手 Web 前端 Design System

## 1. Atmosphere & Identity

白色工作台：纯白色系界面，品牌蓝是唯一强调色。界面像一张明亮的工作台而不是深色控制台——大面积留白、清晰的蓝色动作、克制的语义状态色。亮色主题为默认与主基调，暗色主题保留为可选外观，但不作为设计基准。

- 亮色不使用黑色块；最深元素是近黑墨色正文 `#1c2333`。
- 品牌蓝 `#2e6bf0` 只用于操作、选中与信息提示，不做大面积装饰。
- 新颜色必须先写入 `src/theme/tokens.css` 的**明暗两套主题**，并加入本表。

## 2. Color

### Palette（定义于 `src/theme/tokens.css`）

| Role | Token | Light | Dark | Usage |
| --- | --- | --- | --- | --- |
| Canvas | `--background` | `#f7f8fa` | `#17181a` | 应用背景 |
| Surface/translucent | `--surface` | `rgb(255 255 255 / 92%)` | `rgb(39 40 43 / 80%)` | 侧栏、次级面板 |
| Surface/solid | `--surface-solid` | `#ffffff` | `#27282b` | 表单、卡片 |
| Surface/elevated | `--surface-elevated` | `#ffffff` | `#2e2f33` | 弹窗、浮层 |
| Text/primary | `--text-primary` | `#1c2333` | `#f5f5f7` | 标题、正文 |
| Text/secondary | `--text-secondary` | `#5b6474` | `#a8abb2` | 说明、元信息 |
| Text/faint | `--text-faint` | `#8a93a6` | `#7b8089` | 弱化占位 |
| Border | `--border` | `rgb(28 35 51 / 10%)` | `rgb(235 235 245 / 14%)` | 分隔线、输入框 |
| Border/subtle | `--border-subtle` | `rgb(28 35 51 / 6%)` | `rgb(235 235 245 / 8%)` | 卡片弱边框 |
| Action | `--accent` | `#2e6bf0` | `#0a84ff` | 主操作、焦点 |
| Action/strong | `--accent-strong` | `#1f56d6` | `#0066cc` | 主按钮默认状态 |
| Action/text | `--accent-text` | `#1f56d6` | `#409cff` | 链接和强调文字 |
| Action/soft | `--accent-soft` | `#eaf0fe` | `#173652` | 选中底色、信息提示 |
| Status/success | `--success` | `#248a3d` | `#30d158` | 成功 |
| Status/success text | `--success-text` | `#1f7a35` | `#30d158` | 成功状态文字 |
| Status/warning | `--warning` | `#b25000` | `#ff9f0a` | 需确认、告警 |
| Status/error | `--danger` | `#ff3b30` | `#ff453a` | 失败、危险操作 |
| Status/error text | `--danger-text` | `#d70015` | `#ff6961` | 错误状态文字 |
| Modal backdrop | `--modal-backdrop` | `rgb(23 24 26 / 28%)` | `rgb(0 0 0 / 58%)` | 模态遮罩 |
| Sidebar | `--sidebar` | `rgb(236 238 242 / 82%)` | `rgb(30 31 34 / 88%)` | 工作台导航 |

### Rules

- 语义色（绿/琥珀/红）只表达状态，且必须同时使用文字或图形，不只依赖颜色。
- `--primary` 是 `--accent` 的遗留别名，存量样式可用，新代码一律写 `--accent`。
- 暗色主题与亮色共用同一套 token 名；新增颜色变量必须两个主题各写一份（`design-contrast.test.ts` 有 parity 守卫）。

## 3. Typography

### Scale

默认正文 15px，标题用字重而非大字距拉开层级。新增组件优先使用字号阶梯 token：

| Token | Value | Usage |
| --- | --- | --- |
| `--font-size-12` | 12px | Caption、状态与版本 |
| `--font-size-13` | 13px | 辅助说明（正文下限） |
| `--font-size-14` | 14px | 次级正文、表单 |
| `--font-size-16` | 16px | 面板标题、强调正文 |
| `--font-size-18` | 18px | 卡片组标题 |
| `--font-size-22` | 22px | 页面标题 |
| `--font-size-28` | 28px | 工作台大标题 |

### Font Stack

- Text: `"SF Pro Text", "PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- Mono: `"SF Mono", "Cascadia Code", monospace`

### Rules

- 正文不得小于 13px，关键说明不得小于 14px。
- 长正文保持至少 1.5 行高。
- 不加载远程字体，保证离线可用。

## 4. Spacing & Layout

### Base Unit

所有间距基于 4px，使用 `--space-1`(4px) 到 `--space-16`(64px) 阶梯。

### Radius

| Token | Value | Usage |
| --- | --- | --- |
| `--radius-6` | 6px | 标签、小控件 |
| `--radius-10` | 10px | 输入框、按钮 |
| `--radius-14` | 14px | 普通卡片 |
| `--radius-20` | 20px | 主面板、浮层 |

### Grid

- 桌面最大内容宽度：`1120px`。
- 工作台：约 `232px` 导航 + 自适应内容。
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
- **Accessibility:** `role="status"` 用于非阻断变化，`role="alert"` 用于失败。

### Navigation

- 侧栏选中项为霁蓝 pill（`--accent-soft` 底 + `--accent-text` 文字），分组用 overline 小标题分隔。
- 顶栏平铺白色，无悬浮阴影；品牌区为两行（产品名 + 环境/版本）。

## 6. Motion & Interaction

| Type | Duration | Easing | Usage |
| --- | --- | --- | --- |
| Micro | `120ms` | `ease-out` | 按钮、输入框状态 |
| Standard | `200ms` | `ease-in-out` | 状态面板、弹窗 |
| Emphasis | `420ms` | `cubic-bezier(0.16, 1, 0.3, 1)` | 首次出现 |

- 只动画 `transform`、`opacity` 和颜色。
- 所有按钮和输入框必须有 hover、active、focus-visible、disabled。
- `prefers-reduced-motion: reduce` 时关闭非必要动画。

## 7. Depth & Surface

阴影统一使用三档 token，不再就地手写阴影：

| Token | Usage |
| --- | --- |
| `--shadow-rest` | 卡片静止态、输入框 |
| `--shadow-pop` | 下拉、浮层、hover 抬升 |
| `--shadow-lg` | 模态、启动页主卡片 |

- 普通结构主要依赖 tonal shift 和 1px 边框。
- 禁止多层重阴影、霓虹、强渐变和大面积玻璃拟态。

## 8. 工程约定

- 样式以语义 className + `src/styles/*.css` 规则组织；不在 TSX 中堆内联颜色样式。
- Tailwind v4 仅作工具类补充（`src/theme/tailwind.css`，跳过 preflight），设计变量仍归 `tokens.css` 单一来源。
- 测试走 ARIA 角色断言：视觉改动不得破坏 DOM 语义与可访问名。
- 视觉基线守卫见 `tests/design-contrast.test.ts`（token 阶梯、双主题阴影、明暗 parity、chat 布局规则）。
