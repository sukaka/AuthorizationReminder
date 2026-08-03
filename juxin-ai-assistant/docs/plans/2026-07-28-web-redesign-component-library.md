# Web 前端重设计方案:组件库重构(2026-07-28)

## 背景与问题

用户反馈 web 系统(`apps/desktop` 的浏览器版本)界面难看,要求出重设计方案,选定方向为"引入组件库重构",本轮**只出设计方案与原型,不动业务代码**。

现状(调研结论):

- 样式为纯全局 CSS:`src/theme/tokens.css` 单文件 11172 行,token 与全部页面样式混在一起;另有 4 个页面级 CSS(共约 4300 行)。
- 设计 token 仅约 20 个,缺完整字号/圆角/阴影/间距阶梯;暗色模式只有 3 处 `data-theme` 匹配,大量页面按浅色硬编码。
- 内联 `style={{}}` 散落严重(OpsDashboardPage 104 处、WorkflowsPage 56 处等)。
- antd@5 已在依赖中,但只有 `src/theme/ThemeProvider.tsx` 用了 `ConfigProvider`,页面未使用 antd 组件。
- 30+ 个 Vitest 用例按现有 className/DOM 断言,`tests/design-contrast.test.ts` 守卫 token 对比度。

## 目标 / 非目标

目标:

1. 确立新视觉方向与完整设计 token 体系(颜色、字号、间距、圆角、阴影,明暗双主题对等覆盖)。
2. 选定组件库并给出与现有 CSS 变量主题桥的集成方式。
3. 给出分批迁移路线,每批可独立验证、可回滚。
4. 产出高保真静态原型(应用外壳 + 聊天主界面)供确认。

非目标:

- 不改 `apps/wechat-h5`(手机端,代码独立,本轮不动)。
- 不改 Tauri 桌面壳能力;web 与桌面壳共用同一套 React 代码,视觉升级两者同时受益。
- 不改后端 API、路由结构、页面功能与状态契约。
- 本轮不写任何业务代码。

## 组件库选型(已确认:Tailwind + shadcn/ui)

| 方案 | 说明 | 工作量 | 风险 |
| --- | --- | --- | --- |
| antd v5 + 自定义 theme | 依赖已存在,`ConfigProvider` 已接入;中后台组件最全 | 中 | 默认观感偏"管理后台" |
| **Tailwind + shadcn/ui(选定)** | 视觉上限最高、最现代;组件源码入库、可完全定制;与 CSS 变量 token 天然契合 | 大 | 需引入 Tailwind 工具链,组件逐步重写,30+ 测试随页面批更新,周期约为 antd 方案两倍 |

**用户已选定 Tailwind + shadcn/ui。** 落地方式:

- 设计 token 仍以 CSS 变量为唯一事实来源(oklch 语义色 + 字阶/间距/圆角/阴影阶梯),通过 Tailwind theme 映射(`colors.*` → `var(--token)`)供工具类使用,明暗主题仍由 `data-theme` 切换。
- shadcn/ui 组件以 CLI 方式加入 `src/components/ui/`,源码归项目所有,按新视觉定制圆角/字阶/配色,去除默认观感。
- 现有 antd 依赖在全部页面迁移完成后移除(Phase 3 收尾项)。
- 迁移按"页面批"推进:每批内把该页的原生元素/内联样式替换为 shadcn 组件 + 工具类,同步更新该页 Vitest 断言。

## 视觉方向:白色工作台(White Workbench)

已确认采用**白色系克制商务风**(2026-07-28 评审结论:弃用暖纸/墨色方案):纯白底、蓝灰文字、发丝级分隔线、霁蓝(cobalt)为唯一强调色——品牌标、导航选中态、主按钮、发送键等关键动作位统一使用品牌蓝,不使用黑色块;衬线数字/拉丁字体(Fraunces)点缀。明暗自始至终对等设计。

token 阶梯(原型已按此实现,详见 `prototypes/redesign-2026-chat.html`):

- **颜色**:语义化分层 `bg / surface / surface-2 / ink / ink-2 / muted / line / accent / accent-soft / success / warning / danger`,明暗两套;中性色向品牌色相微偏,禁用纯黑纯白。
- **字号**:12 / 13 / 14 / 16 / 18 / 22 / 28 七级,正文 14;数字与拉丁标题用 Fraunces(衬线)形成识别点,中文正文保持 PingFang SC / Noto Sans SC。
- **间距**:4 基元,常用 4/8/12/16/24/32/48。
- **圆角**:6 / 10 / 14 / 20,消息与 composer 用 14-20,控件 8-10。
- **阴影**:两级(卡片静置、浮层弹出),低透明、小扩散,暗色下改用内发光描边。
- **动效**:ease-out-quart 200ms 内的位移+透明度;页面载入一次性交错入场;不动 layout 属性。

布局要点:

- 外壳:248px 侧栏(分组导航、当前项为品牌蓝填充 pill)、顶栏(页面语境 + 全局搜索 + 主题切换 + 用户)。
- 聊天页:720px 居中阅读栏;助手消息取消气泡、采用开放式编辑排版;用户消息为右侧浅色卡片;工具运行过程收敛为可展开"运行卡片";引用、附件、确认卡(PPT 生成确认等)组件化;composer 为悬浮式圆角卡片,集成附件、模型选择、发送。

## 迁移路线

- **Phase 0 地基(1 批)**:接入 Tailwind 工具链与 shadcn/ui(`src/components/ui/`);拆分 `tokens.css` 为 `tokens / base / components / pages` 四层;补齐 token 阶梯与暗色覆盖;token → Tailwind theme 映射;扩展 `design-contrast.test.ts` 覆盖新 token。不改变任何视觉表现,纯工程重构。
- **Phase 1 试点(1 批)**:应用外壳(`App.tsx` 侧栏/顶栏)+ `ChatPage` 按新设计落地,同步更新 chat 相关 Vitest/Playwright 用例。试点确认后再继续。
- **Phase 2 主流程页面**:任务/交付/历史/知识库/学习,逐页替换为 shadcn 组件并清内联样式。
- **Phase 3 管理页面与收尾**:admin 15 个子页;删除旧 CSS 与未用样式;移除 antd 依赖;重写 `apps/desktop/DESIGN.md`;移除纯装饰的旧 token。

每批遵循:最小可 review 改动 → 匹配范围测试 → `git diff --check`。

## 测试与验证

- 样式守卫:扩展 `tests/design-contrast.test.ts` 校验全部语义色明暗两套均过 WCAG AA。
- 单测:逐页把按旧 className 的断言迁移到新结构(Phase 内同步完成,不留红)。
- 验证命令(改动批内按需运行):

```bash
cd apps/desktop
npm run typecheck
npm test -- --reporter=dot
npm run build
```

## 交付物

- 本方案文档。
- 高保真静态原型:`prototypes/redesign-2026-chat.html`(单文件,浏览器直接打开,含明暗主题切换、运行卡片展开等交互)。

## 评审结论(2026-07-28,用户已确认)

1. 视觉方向:**白色系**,亮色主题为纯白配色,不使用黑色块;品牌蓝作为唯一强调色。
2. 组件库:**Tailwind + shadcn/ui**,接受相应周期。
3. Fraunces 字体:确认可用,离线部署时自托管(OFL 授权)。

下一步:等待用户下达开工指令后,从 Phase 0 起步。

## Phase 0 实施记录(2026-07-28 完成)

已完成地基工程,全程零视觉变更:

- **tokens.css 拆分**:`src/theme/tokens.css`(11172 行)→ `tokens.css`(纯变量,73 行)+ `index.css`(@import 链)+ `styles/` 下 19 个功能区文件(05-chat-attachments … 90-app-dialog)。字节级验证:拼接结果与原文件 diff 为空,级联顺序不变。
- **Tailwind v4 接入**:`@tailwindcss/vite` 插件;`src/theme/tailwind.css` 只导入 theme + utilities 两层并放入 cascade layer,**跳过 preflight**(reset 仍由旧样式负责);`@theme inline` 把颜色/字号/圆角/阴影映射到运行时 CSS 变量,Tailwind 类自动跟随 `data-theme`。
- **shadcn/ui 地基**:`components.json`(new-york 风格、css 指向 tailwind.css)、`src/lib/utils.ts` 的 `cn()`、tsconfig/vite 的 `@/*` 别名;依赖 clsx、tailwind-merge、class-variance-authority。组件尚未引入,Phase 1 按需 `shadcn add`。
- **token 阶梯(纯新增)**:light 块新增 `--font-size-12..28`、`--radius-6/10/14/20`、`--shadow-rest/pop`;dark 块新增 `--shadow-rest/pop`。
- **测试**:`tests/helpers/themeCss.ts` 递归内联 index.css 供断言使用;design-contrast/proxy-config 两个测试改用它;design-contrast 新增 3 个守卫(阶梯完整性、双主题阴影、明暗 token parity)。

验证:typecheck 通过;vitest 45 文件 358+3 用例通过;`npm run build` 通过;`git diff --check` 干净。

注意:`src/api/client.ts`、`TasksPage.tsx`、`tasks-page.test.tsx` 及 server/ 若干文件存在其他工作流的未提交改动,本 Phase 未触碰。

## Phase 1 实施记录(外壳部分,2026-07-28 完成)

- **白色调色板上线**:`tokens.css` light 块切换为白色工作台配色(背景 #f7f8fa、墨蓝文字 #1c2333、霁蓝 accent #2e6bf0 / accent-text #1f56d6);新增 `--text-faint`(明暗双主题)。全站基础配色随之切换,页面级细节逐页迁移。
- **外壳重写**(`15-app-shell.css` 前 456 行):侧栏改为扁平浅色底 + 发丝边框,当前导航项为霁蓝 pill(白字 + 蓝色投影);新增导航分组标题(主导航 / 管理与设置);品牌区两行(名称 + 副标题);底部用户区加渐变头像 + 在线点;顶栏去毛玻璃改平铺白底;侧栏模式 segmented 与主题切换器统一为 pill 风格。
- **行为契约不变**:ARIA 结构(导航分组、按钮名、侧边栏三态、系统切换、退出)全部保留,`admin-navigation` 等测试未改即通过。
- 验证:typecheck 绿;vitest 45/361 绿;Playwright 截图确认展开/收起两种侧栏形态(`output/design-review/shell-phase1.png`);`git diff --check` 干净。
- 已知待办:ChatPage 区域仍是旧样式(红色硬编码按钮、旧会话栏),下一步按白色工作台原型重做。

## Phase 1 实施记录(ChatPage 换肤,2026-07-28 完成)

- **聊天页品牌色切换**:`50-chat.css` 的 `--chat-brand` 系列由硬编码红(#d71920)改为跟随全局霁蓝 token,59 处引用一次换肤;其余红色/浅蓝硬编码(头像、空态 pill、用户气泡边框、附件栏、引用选择器、停止按钮、记忆建议卡)全部 token 化。
- **补齐缺失 token(存量 bug)**:`--border-subtle`、`--shadow-lg` 在 chat/app-shell/models-skills 三处被引用但从未定义,已在明暗双主题补上;`.chat-attachment-type` 引用的 `--primary` 同样未定义,改用 accent token。
- 布局规则未动(design-contrast 锁定的 composer 宽度、会话卡、run-context 等断言保持原样)。
- 验证:typecheck 绿;vitest 45/361 绿;截图 `output/design-review/chat-phase1-reskin.png`(全页霁蓝+白底,无红色残留);`git diff --check` 干净。
- 待办:会话列表面板、消息流排版、composer 细节按原型进一步重做(涉及 design-contrast 锁定断言的同步更新);知识搜索/工作流页的硬编码红归 Phase 2。

## Phase 1 实施记录(ChatPage 深改,2026-07-28 完成)

- **Composer**:去毛玻璃、换 `--shadow-pop` 浮层阴影;focus-within 用 accent 描边+光环(原先引用未定义的 `--primary`,已作为 accent 别名补进双主题,顺带修复 32-dialogs 中 6 处同样失效的引用);工具栏 chips 收窄到 32px、白底细边;发送键 34px 圆形 + 品牌蓝投影。
- **会话面板**:标题字距对齐导航分组(12px/`--text-faint`/.12em);开启新任务按钮加重 600 + 蓝色投影;会话卡边框统一 `--border`、阴影 `--shadow-rest`,选中态改为蓝色描边 + 3px 外光环;批量操作/加载更多按钮去内阴影。
- **消息流**:助手消息去卡片化(透明气泡、无阴影,开放式编辑排版);用户头像由墨黑实心改为白底细边灰字;用户气泡保持霁蓝浅底。
- **存量失效变量修复**:`--primary`(16 处引用)、`--shadow-soft` 已在 tokens 双主题定义别名。
- design-contrast 锁定断言全部保持通过(未改其锁定的布局规则);vitest 45/361 绿;截图 `output/design-review/chat-phase1-deep.png`。
- 说明:消息气泡的视觉验证只覆盖了空态;有会话内容的气泡/运行卡片渲染未在本地真实数据下走查(需可用的模型 Runtime),建议 Phase 2 前在 staging 或真实会话里人工过一遍。

至此 Phase 1(外壳 + ChatPage)完成。下一阶段 Phase 2:任务/交付/历史/知识库/学习页面换肤与内联样式清理(含知识搜索、工作流页的残留硬编码红)。

## Phase 2 实施记录(主流程页面 token 化,2026-07-28 完成)

- **5 个样式文件约 240 处硬编码颜色 token 化**:28-knowledge-search(38)、24-knowledge(24)、45-tasks(10)、22-learning(3)、professional-delivery.css(70,含 10 个 `--pro-*` 局部 token 重映射);WorkflowsPage 内联 `#b91c1c` → `var(--danger-text)`。
- 规则:品牌蓝/品牌红 → accent 系;语义色(状态绿/琥珀/紫/错误红)保留;阴影按模糊半径就近映射到 rest/pop/lg;`--modal-backdrop` 复用。品牌色残留 grep 零命中。
- **Phase 3 先行小项**(同轮完成):40-models-skills tone-1 与 5 处阴影、32-dialogs 两处 #0a84ff、20-overview hero 渐变、60-workflows 3 处阴影、75/26 两处阴影。
- 验证:typecheck 绿;vitest 45/361 绿;截图 `output/design-review/p2-knowledge.png`、`p2-tasks.png`(白底霁蓝,无旧红/旧蓝残留);`git diff --check` 干净。
- 说明:任务页截图中的 `AGENT_RUNS_FAILED` 是本地 dev 库数据问题,与样式无关。TSX 内联样式(OpsDashboard 104 处等)集中在管理页,归 Phase 3 处理。

## Phase 3 实施记录(antd 移除 + DESIGN.md + TSX 内联清理,2026-07-28 完成)

- **antd 移除**:全项目仅 `theme/ThemeProvider.tsx` 一处引用(ConfigProvider + 明暗 algorithm),直接删除包装,保留 useTheme/主题切换器逻辑;`npm uninstall antd` 移除 65 个包,typecheck/vitest/build 全绿,全库无 antd 残留。
- **DESIGN.md 重写**:旧文档描述 macOS 雾白风,已重写为白色工作台体系——新调色板表(含 --text-faint/--border-subtle)、字号/圆角/阴影三档 token 阶梯、"新颜色必须同时写入明暗双主题"规则、Tailwind 仅作工具类补充的工程约定。
- **TSX 内联样式清理**(193 处起点):
  - `OpsDashboardPage.tsx`:91 处静态 → 70-admin.css 新规则(admin-stat/ops-card/ops-table 等约 50 个 className);13 处真动态保留(statusColor 离散变色、数据计算背景);顺手补了原本无定义的 `admin-stat-grid` 死类名;`--panel`/`--panel-muted` 等不存在变量的 fallback 归并为真实 token。
  - `WorkflowsPage.tsx`:56 处全部清零;4 处离散条件样式转 `is-parallel`/`is-valid`/`is-dragging` 等修饰类;两处依赖内联 style 的旧 CSS 选择器(`[style*=...]`、带 !important)同步重写。
  - 其余 7 文件 28 处:KnowledgeAdmin 8(governance-version 系列)、Assistants 7(catalog-role 系列)、CitationPreviewDrawer 5、History 3、Learning 2、DocumentBlockEditor 2(1 动态保留)、Knowledge 1(树缩进为数据计算值,保留)。
  - 未触碰 TasksPage.tsx 的 5 处(他人未提交改动)。
- 颜色全部映射 tokens.css 现有变量,零新增 token、零新 hex;近似色用 color-mix(var(--accent)/--success/--danger)。
- 验证:typecheck 绿;vitest 45 文件/361 用例绿(三轮子代理各自验证 + 最终复验);build 绿;`git diff --check` 干净。
- 遗留(低优先,不影响主流程):`pages/chat-run-prototype.css` 为 Demo 页专用样式未 token 化;`launcher/launcher.css` 为 Tauri 启动壳,不属于 web 系统范围;真实会话数据下的消息气泡/运行卡片渲染仍需在可用 Runtime 环境人工走查。
