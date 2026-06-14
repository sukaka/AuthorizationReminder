# 统一大屏明亮白色主题实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将统一大屏中心的 12 套模板升级为已确认的“云端白瓷”明亮主题，同时保持现有布局、动态效果、深度交互、WebGL 降级和双屏比例能力。

**Architecture:** 新增类型化的 `screen-theme.ts` 作为主题单一来源，`ScreenPlayer` 根据 `systemKey` 提供主题对象并写入 CSS 变量。DOM 组件消费 CSS 变量，ECharts、G6、MapLibre、DataV 消费注入的主题对象，Three.js 从容器读取同一主题变量，避免在模板和组件中重复硬编码颜色。

**Tech Stack:** Vue 3、TypeScript、CSS Custom Properties、Vitest、Vue Test Utils、Playwright、Apache ECharts、ECharts GL、Three.js、AntV G6、MapLibre GL JS、DataV Vue3、tsParticles

**Execution note:** 用户已明确禁止使用 Git worktree。本计划必须直接在 `/Users/zhanglei/Documents/codex-new` 主目录执行；每次提交只暂存任务列出的文件，不处理现有无关未跟踪文件。

---

## 文件结构

### 新建文件

- `big-screen-center/frontend/src/theme/screen-theme.ts`
  - 定义 `ScreenTheme`、三个系统主题、Vue 注入键和 CSS 变量转换。
- `big-screen-center/frontend/tests/screen-theme.test.ts`
  - 验证系统主题和 CSS 变量。
- `big-screen-center/frontend/e2e/bright-theme.spec.ts`
  - 验证 12 套模板的明亮主题、核心组件可见性和代表性截图。
- `big-screen-center/frontend/e2e/bright-theme.spec.ts-snapshots/`
  - 保存 `sca-01`、`train-02`、`remind-03` 的 1920×1080 基准图和三套超宽基准图。

### 修改文件

- `big-screen-center/frontend/src/components/ScreenPlayer.vue`
  - 提供主题、写入 CSS 变量、更新画布和标题区。
- `big-screen-center/frontend/src/components/SourceHealthBar.vue`
  - 更新明亮状态标签。
- `big-screen-center/frontend/src/components/InteractionConsole.vue`
  - 更新白色联动分析台。
- `big-screen-center/frontend/src/components/PlaylistPanel.vue`
  - 更新浅色播放控制面板。
- `big-screen-center/frontend/src/App.vue`
- `big-screen-center/frontend/src/styles/base.css`
- `big-screen-center/frontend/src/components/ScreenEditor.vue`
  - 将模板目录、全局导航和编辑器外壳同步为明亮主题。
- `big-screen-center/frontend/src/components/widgets/MetricCards.vue`
- `big-screen-center/frontend/src/components/widgets/RankingTable.vue`
- `big-screen-center/frontend/src/components/widgets/StatusMatrix.vue`
- `big-screen-center/frontend/src/components/widgets/TechFrame.vue`
- `big-screen-center/frontend/src/components/widgets/EChartPanel.vue`
- `big-screen-center/frontend/src/components/widgets/ParticleVeil.vue`
- `big-screen-center/frontend/src/components/widgets/GraphPanel.vue`
- `big-screen-center/frontend/src/components/widgets/MapPanel.vue`
- `big-screen-center/frontend/src/components/widgets/ThreeScene.vue`
  - 让全部组件使用明亮主题令牌。
- `big-screen-center/frontend/src/scenes/createOrbitScene.ts`
- `big-screen-center/frontend/src/scenes/createRiskGlobe.ts`
- `big-screen-center/frontend/src/scenes/createCourseGalaxy.ts`
- `big-screen-center/frontend/src/scenes/createExpiryOrbit.ts`
  - 让 Three.js 场景从容器主题生成颜色。
- `big-screen-center/frontend/public/assets/maps/style-offline.json`
  - 将离线地图改为浅色样式。
- `big-screen-center/frontend/tests/interactive-widgets.test.ts`
- `big-screen-center/frontend/tests/source-health-bar.test.ts`
- `big-screen-center/frontend/tests/interaction-console.test.ts`
- `big-screen-center/frontend/tests/echart-interaction.test.ts`
- `big-screen-center/frontend/tests/graph-map-interaction.test.ts`
- `big-screen-center/frontend/tests/scene-interaction.test.ts`
  - 覆盖主题适配和浅色交互状态。
- `big-screen-center/frontend/tests/helpers/interaction.ts`
  - 为组件测试提供默认或指定系统的屏幕主题。

---

### Task 1: 建立类型化主题基础

**Files:**
- Create: `big-screen-center/frontend/src/theme/screen-theme.ts`
- Create: `big-screen-center/frontend/tests/screen-theme.test.ts`
- Modify: `big-screen-center/frontend/src/components/ScreenPlayer.vue`
- Modify: `big-screen-center/frontend/tests/helpers/interaction.ts`

- [ ] **Step 1: 编写系统主题失败测试**

在 `tests/screen-theme.test.ts` 中写入：

```ts
import { describe, expect, it } from 'vitest'

import {
  SCREEN_THEMES,
  screenThemeCssVariables,
  screenThemeFor,
} from '../src/theme/screen-theme'

describe('bright screen themes', () => {
  it('defines one bright porcelain theme per system', () => {
    expect(Object.keys(SCREEN_THEMES)).toEqual([
      'sca',
      'train-exam',
      'reminder',
    ])

    for (const theme of Object.values(SCREEN_THEMES)) {
      expect(theme.canvas).toBe('#f4f9fc')
      expect(theme.surface).toContain('255 255 255')
      expect(theme.text).toBe('#102a43')
      expect(theme.danger).toBe('#f0645a')
    }
  })

  it('keeps system accents distinct', () => {
    expect(screenThemeFor('sca').accent).toBe('#1976ed')
    expect(screenThemeFor('train-exam').accent).toBe('#008b78')
    expect(screenThemeFor('reminder').accent).toBe('#e5663f')
  })

  it('maps the complete theme to CSS variables', () => {
    expect(screenThemeCssVariables(screenThemeFor('sca'))).toMatchObject({
      '--screen-canvas': '#f4f9fc',
      '--screen-text': '#102a43',
      '--screen-accent': '#1976ed',
      '--screen-accent-secondary': '#18b8c9',
      '--screen-signal': '#29c58b',
      '--screen-warning': '#f3ab28',
      '--screen-danger': '#f0645a',
    })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd /Users/zhanglei/Documents/codex-new/big-screen-center/frontend
npm test -- --run tests/screen-theme.test.ts
```

Expected: FAIL，提示 `../src/theme/screen-theme` 不存在。

- [ ] **Step 3: 实现主题类型、主题表和 CSS 变量转换**

在 `src/theme/screen-theme.ts` 中实现：

```ts
import {
  computed,
  inject,
  provide,
  type ComputedRef,
  type InjectionKey,
} from 'vue'

import type { SystemKey } from '../types'

export interface ScreenTheme {
  canvas: string
  stage: string
  surface: string
  surfaceSolid: string
  text: string
  muted: string
  line: string
  grid: string
  accent: string
  accentSecondary: string
  signal: string
  warning: string
  danger: string
  idle: string
  shadow: string
}

const shared = {
  canvas: '#f4f9fc',
  stage: '#e9f2f7',
  surface: 'rgb(255 255 255 / 84%)',
  surfaceSolid: '#fbfdfe',
  text: '#102a43',
  muted: '#688197',
  line: 'rgb(35 91 137 / 15%)',
  grid: 'rgb(49 116 157 / 5.5%)',
  signal: '#29c58b',
  warning: '#f3ab28',
  danger: '#f0645a',
  idle: '#e6eff4',
  shadow: 'rgb(34 92 129 / 9%)',
} satisfies Omit<ScreenTheme, 'accent' | 'accentSecondary'>

export const SCREEN_THEMES = {
  sca: { ...shared, accent: '#1976ed', accentSecondary: '#18b8c9' },
  'train-exam': { ...shared, accent: '#008b78', accentSecondary: '#35a7d6' },
  reminder: { ...shared, accent: '#e5663f', accentSecondary: '#e6a52d' },
} as const satisfies Record<SystemKey, ScreenTheme>

export const screenThemeFor = (systemKey: SystemKey): ScreenTheme =>
  SCREEN_THEMES[systemKey]

export const screenThemeCssVariables = (
  theme: ScreenTheme,
): Record<string, string> => ({
  '--screen-canvas': theme.canvas,
  '--screen-stage': theme.stage,
  '--screen-surface': theme.surface,
  '--screen-surface-solid': theme.surfaceSolid,
  '--screen-text': theme.text,
  '--screen-muted': theme.muted,
  '--screen-line': theme.line,
  '--screen-grid': theme.grid,
  '--screen-accent': theme.accent,
  '--screen-accent-secondary': theme.accentSecondary,
  '--screen-signal': theme.signal,
  '--screen-warning': theme.warning,
  '--screen-danger': theme.danger,
  '--screen-idle': theme.idle,
  '--screen-shadow': theme.shadow,
})

export const screenThemeKey: InjectionKey<ComputedRef<ScreenTheme>> =
  Symbol('screen-theme')

export const provideScreenTheme = (systemKey: ComputedRef<SystemKey>) => {
  const theme = computed(() => screenThemeFor(systemKey.value))
  provide(screenThemeKey, theme)
  return theme
}

export const useScreenTheme = () => {
  const theme = inject(screenThemeKey)
  if (!theme) throw new Error('Screen theme provider is missing')
  return theme
}
```

- [ ] **Step 4: 让测试辅助器提供系统主题**

修改 `tests/helpers/interaction.ts` 的 `mountWithInteraction`：

```ts
import type { SystemKey } from '../../src/types'
import {
  screenThemeFor,
  screenThemeKey,
} from '../../src/theme/screen-theme'

// 在现有第三个 options 参数后增加：
systemKey: SystemKey = 'sca',

// 在现有 api 定义后增加：
const theme = computed(() => screenThemeFor(systemKey))

// 在现有 global.provide 对象中增加：
[screenThemeKey as symbol]: theme,
```

现有测试不传第四个参数时使用 SCA 主题；提醒系统地图测试传 `'reminder'`，培训考试主题测试传 `'train-exam'`。

- [ ] **Step 5: 让 ScreenPlayer 提供主题并合并画布样式**

在 `ScreenPlayer.vue` 中：

```ts
import {
  provideScreenTheme,
  screenThemeCssVariables,
} from '../theme/screen-theme'

const theme = provideScreenTheme(systemKey)

const canvasStyle = computed(() => ({
  width: `${transform.value.designWidth}px`,
  height: `${transform.value.designHeight}px`,
  transform: `translate(${transform.value.offsetX}px, ${transform.value.offsetY}px) scale(${transform.value.scaleX})`,
  ...screenThemeCssVariables(theme.value),
}))
```

给画布增加：

```vue
:data-screen-theme="template.systemKey"
```

将基础颜色替换为：

```css
.screen-stage {
  background: var(--screen-stage, #e9f2f7);
}

.screen-canvas {
  color: var(--screen-text);
  background:
    linear-gradient(90deg, var(--screen-grid) 1px, transparent 1px) 0 0 / 72px 72px,
    linear-gradient(var(--screen-grid) 1px, transparent 1px) 0 0 / 72px 72px,
    radial-gradient(circle at 50% 30%, color-mix(in srgb, var(--screen-accent-secondary), transparent 87%), transparent 38%),
    linear-gradient(145deg, var(--screen-surface-solid), var(--screen-canvas));
}
```

删除旧的 `.screen-canvas--train-exam` 和 `.screen-canvas--reminder` 硬编码颜色。

- [ ] **Step 6: 运行主题测试和类型检查**

Run:

```bash
npm test -- --run tests/screen-theme.test.ts
npm run typecheck
```

Expected: 新增测试通过，类型检查通过。

- [ ] **Step 7: 提交主题基础**

```bash
cd /Users/zhanglei/Documents/codex-new
git add \
  big-screen-center/frontend/src/theme/screen-theme.ts \
  big-screen-center/frontend/src/components/ScreenPlayer.vue \
  big-screen-center/frontend/tests/screen-theme.test.ts \
  big-screen-center/frontend/tests/helpers/interaction.ts
git commit -m "feat(big-screen): add bright porcelain theme foundation"
```

Expected: 自动版本机制升级次版本并推送对应的新版本分支。

---

### Task 2: 改造 DOM 面板、状态和播放控制

**Files:**
- Modify: `big-screen-center/frontend/src/App.vue`
- Modify: `big-screen-center/frontend/src/styles/base.css`
- Modify: `big-screen-center/frontend/src/components/ScreenEditor.vue`
- Modify: `big-screen-center/frontend/src/components/SourceHealthBar.vue`
- Modify: `big-screen-center/frontend/src/components/InteractionConsole.vue`
- Modify: `big-screen-center/frontend/src/components/PlaylistPanel.vue`
- Modify: `big-screen-center/frontend/src/components/widgets/MetricCards.vue`
- Modify: `big-screen-center/frontend/src/components/widgets/RankingTable.vue`
- Modify: `big-screen-center/frontend/src/components/widgets/StatusMatrix.vue`
- Modify: `big-screen-center/frontend/tests/interactive-widgets.test.ts`
- Modify: `big-screen-center/frontend/tests/source-health-bar.test.ts`
- Modify: `big-screen-center/frontend/tests/interaction-console.test.ts`
- Modify: `big-screen-center/frontend/tests/playlist-panel.test.ts`

- [ ] **Step 1: 为明亮状态增加失败测试**

在组件根节点增加可断言的数据属性，测试中断言：

```ts
expect(wrapper.get('[data-source-status="partial"]')
  .classes()).toContain('source-health--light')

expect(wrapper.get('[data-interaction-console]')
  .classes()).toContain('interaction-console--light')

expect(wrapper.get('[data-widget="metric-cards"]')
  .attributes('data-theme-surface')).toBe('bright')
```

状态矩阵增加语义属性断言：

```ts
expect(wrapper.get('[data-interaction-key="successRate"]')
  .attributes('data-status-level')).toBe('healthy')
expect(wrapper.get('[data-interaction-key="totalReminders"]')
  .attributes('data-status-level')).toBe('idle')
```

- [ ] **Step 2: 运行定向测试确认失败**

```bash
cd /Users/zhanglei/Documents/codex-new/big-screen-center/frontend
npm test -- --run \
  tests/interactive-widgets.test.ts \
  tests/source-health-bar.test.ts \
  tests/interaction-console.test.ts \
  tests/playlist-panel.test.ts
```

Expected: FAIL，提示新增 class 或 data 属性不存在。

- [ ] **Step 3: 更新指标卡、排行和状态矩阵**

统一应用以下明亮面板基础：

```css
background: var(--screen-surface);
border: 1px solid var(--screen-line);
box-shadow: 0 10px 28px var(--screen-shadow);
```

指标卡：

```vue
<section
  class="metric-cards"
  data-widget="metric-cards"
  data-widget-type="metric-cards"
  data-theme-surface="bright"
>
```

```css
article[data-interaction-state="primary"] {
  border-color: var(--screen-accent);
  box-shadow: 0 16px 34px color-mix(in srgb, var(--screen-accent), transparent 87%);
}

strong {
  color: var(--screen-text);
}

i {
  background: linear-gradient(90deg, var(--screen-accent), var(--screen-accent-secondary));
  box-shadow: none;
}
```

排行：

```css
li b,
li i {
  color: var(--screen-accent);
  background: linear-gradient(90deg, var(--screen-accent), var(--screen-accent-secondary));
}
```

状态矩阵：

```vue
:data-status-level="cell.level"
```

```css
.status-matrix__cell--healthy {
  background: color-mix(in srgb, var(--screen-signal), white 84%) !important;
}

.status-matrix__cell--alert {
  background: color-mix(in srgb, var(--screen-warning), white 82%) !important;
}

.status-matrix__cell--idle {
  background: var(--screen-idle) !important;
}
```

- [ ] **Step 4: 更新状态条、联动分析台和播放控制**

状态条根节点：

```vue
class="source-health source-health--light"
```

错误、关注和正常颜色分别使用：

```css
var(--screen-danger)
var(--screen-warning)
var(--screen-signal)
```

联动分析台根节点：

```vue
class="interaction-console interaction-console--light"
```

改为：

```css
background: var(--screen-surface-solid);
border: 1px solid var(--screen-accent);
box-shadow: 0 -12px 42px var(--screen-shadow);
color: var(--screen-text);
```

播放控制面板改为白色实底、深色文字和主题按钮；移动端布局保持不变。

- [ ] **Step 5: 更新模板目录和编辑器外壳**

将 `src/styles/base.css` 的根主题改为明亮基础，同时保留现有变量名以减少目录和编辑器改动：

```css
:root {
  color-scheme: light;
  --canvas: #eef6f9;
  --surface: #f8fbfd;
  --surface-raised: #ffffff;
  --ink-strong: #102a43;
  --ink-muted: #688197;
  --accent-warm: #1976ed;
  --accent-signal: #29c58b;
  --line-soft: rgb(35 91 137 / 9%);
  --line-strong: rgb(35 91 137 / 18%);
  --danger-surface: #fff0ee;
  --danger-line: #f0645a;
  --danger-ink: #9c2f2a;
}
```

`App.vue` 顶部导航使用白色实底、蓝色品牌块和轻投影：

```css
.topline {
  background: rgb(255 255 255 / 94%);
  border-bottom: 1px solid var(--line-strong);
  box-shadow: 0 8px 28px rgb(34 92 129 / 6%);
}
```

`ScreenEditor.vue` 的画布和组件块使用浅蓝网格、白色组件块和蓝色主按钮：

```css
.screen-editor__grid {
  background:
    linear-gradient(90deg, var(--line-soft) 1px, transparent 1px) 0 0 / 64px 64px,
    linear-gradient(var(--line-soft) 1px, transparent 1px) 0 0 / 64px 64px,
    #f4f9fc;
}

.grid-stack-item-content {
  background: #ffffff;
  box-shadow: 0 8px 22px rgb(34 92 129 / 8%);
}
```

- [ ] **Step 6: 运行组件测试**

```bash
npm test -- --run \
  tests/interactive-widgets.test.ts \
  tests/source-health-bar.test.ts \
  tests/interaction-console.test.ts \
  tests/playlist-panel.test.ts
```

Expected: 全部通过。

- [ ] **Step 7: 提交 DOM 组件明亮主题**

```bash
cd /Users/zhanglei/Documents/codex-new
git add \
  big-screen-center/frontend/src/App.vue \
  big-screen-center/frontend/src/styles/base.css \
  big-screen-center/frontend/src/components/ScreenEditor.vue \
  big-screen-center/frontend/src/components/SourceHealthBar.vue \
  big-screen-center/frontend/src/components/InteractionConsole.vue \
  big-screen-center/frontend/src/components/PlaylistPanel.vue \
  big-screen-center/frontend/src/components/widgets/MetricCards.vue \
  big-screen-center/frontend/src/components/widgets/RankingTable.vue \
  big-screen-center/frontend/src/components/widgets/StatusMatrix.vue \
  big-screen-center/frontend/tests/interactive-widgets.test.ts \
  big-screen-center/frontend/tests/source-health-bar.test.ts \
  big-screen-center/frontend/tests/interaction-console.test.ts \
  big-screen-center/frontend/tests/playlist-panel.test.ts
git commit -m "feat(big-screen): brighten dashboard panels and controls"
```

---

### Task 3: 适配 DataV、ECharts 和粒子效果

**Files:**
- Modify: `big-screen-center/frontend/src/components/widgets/TechFrame.vue`
- Modify: `big-screen-center/frontend/src/components/widgets/EChartPanel.vue`
- Modify: `big-screen-center/frontend/src/components/widgets/ParticleVeil.vue`
- Modify: `big-screen-center/frontend/tests/echart-interaction.test.ts`

- [ ] **Step 1: 扩充 ECharts mock 并编写主题失败测试**

在 `echart-interaction.test.ts` 中使用已支持主题的 `mountWithInteraction`，记录 `setOption` 参数，新增：

```ts
it('uses the injected bright palette for 2D charts', async () => {
  mountWithInteraction(EChartPanel, {
    widget,
    data: { criticalRisks: 48, high: 12 },
    performanceProfile: 'high',
  }, {}, 'sca')
  await flushPromises()

  expect(setOption).toHaveBeenCalledWith(
    expect.objectContaining({
      textStyle: { color: '#102a43' },
      color: ['#1976ed', '#18b8c9', '#29c58b', '#f3ab28', '#f0645a'],
    }),
    true,
  )
})

it('uses a light environment for ECharts GL', async () => {
  const glWidget: WidgetDefinition = {
    ...widget,
    id: 'sca-02-core',
    layoutArea: 'core',
    config: { variant: 'sca-02-core', visualKey: 'threat-radar' },
  }
  mountWithInteraction(EChartPanel, {
    widget: glWidget,
    data: { criticalRisks: 48, high: 12 },
    performanceProfile: 'high',
  }, {}, 'sca')
  await flushPromises()

  expect(setOption.mock.calls.at(-1)?.[0].grid3D.environment).toBe('#f4f9fc')
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -- --run tests/echart-interaction.test.ts
```

Expected: FAIL，当前 option 不包含主题 palette，`grid3D.environment` 仍为 `#14110d`。

- [ ] **Step 3: 让 EChartPanel 使用注入主题**

```ts
import { useScreenTheme } from '../../theme/screen-theme'

const theme = useScreenTheme()

const chartBase = computed(() => ({
  textStyle: { color: theme.value.text },
  color: [
    theme.value.accent,
    theme.value.accentSecondary,
    theme.value.signal,
    theme.value.warning,
    theme.value.danger,
  ],
}))
```

所有 option 合并 `chartBase.value`。替换坐标轴、分割线、Tooltip、面积和 `grid3D.environment` 的暗色硬编码：

```ts
tooltip: {
  backgroundColor: theme.value.surfaceSolid,
  borderColor: theme.value.line,
  textStyle: { color: theme.value.text },
}
```

保持现有 ECharts GL 失败后纯二维降级逻辑。

- [ ] **Step 4: 让 TechFrame 和 ParticleVeil 使用主题**

`TechFrame.vue`：

```ts
const theme = useScreenTheme()
const frameColors = computed(() => [
  theme.value.accent,
  theme.value.line,
])
```

DataV 的 `BorderBox8` 和 `Decoration5` 使用 `frameColors`，数字翻牌使用 `theme.value.text`。

`ParticleVeil.vue` 的粒子颜色改为：

```ts
color: {
  value: [
    theme.value.accent,
    theme.value.accentSecondary,
    theme.value.signal,
  ],
}
```

- [ ] **Step 5: 运行图表测试和类型检查**

```bash
npm test -- --run tests/echart-interaction.test.ts
npm run typecheck
```

Expected: 全部通过。

- [ ] **Step 6: 提交图表与装饰适配**

```bash
cd /Users/zhanglei/Documents/codex-new
git add \
  big-screen-center/frontend/src/components/widgets/TechFrame.vue \
  big-screen-center/frontend/src/components/widgets/EChartPanel.vue \
  big-screen-center/frontend/src/components/widgets/ParticleVeil.vue \
  big-screen-center/frontend/tests/echart-interaction.test.ts
git commit -m "feat(big-screen): apply bright theme to charts and effects"
```

---

### Task 4: 适配 G6 与 MapLibre

**Files:**
- Modify: `big-screen-center/frontend/src/components/widgets/GraphPanel.vue`
- Modify: `big-screen-center/frontend/src/components/widgets/MapPanel.vue`
- Modify: `big-screen-center/frontend/public/assets/maps/style-offline.json`
- Modify: `big-screen-center/frontend/tests/graph-map-interaction.test.ts`

- [ ] **Step 1: 让测试记录 G6 与 MapLibre 构造参数**

在 `graph-map-interaction.test.ts` 的 hoisted mocks 中增加：

```ts
graphOptions: undefined as unknown,
mapOptions: undefined as unknown,
```

Mock 构造函数保存传入参数：

```ts
Graph: vi.fn(function GraphMock(options) {
  mocks.graphOptions = options
  return graphInstance
})

Map: vi.fn(function MapMock(options) {
  mocks.mapOptions = options
  return mapInstance
})
```

新增失败断言：

```ts
expect(mocks.graphOptions).toMatchObject({
  node: {
    style: {
      fill: '#fbfdfe',
      stroke: '#1976ed',
      labelFill: '#102a43',
    },
  },
})

expect(mocks.addLayer).toHaveBeenCalledWith(
  expect.objectContaining({
    paint: expect.objectContaining({
      'circle-color': '#e5663f',
      'circle-stroke-color': '#fbfdfe',
    }),
  }),
)
```

挂载 `MapPanel` 的两个测试调用使用第四个参数指定提醒系统主题：

```ts
mountWithInteraction(MapPanel, {
  widget: mapWidget,
  data: { customer_count: 12, license_count: 30 },
  performanceProfile: 'high',
}, {}, 'reminder')
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -- --run tests/graph-map-interaction.test.ts
```

Expected: FAIL，当前 G6 节点和地图点仍使用深色/金色。

- [ ] **Step 3: 更新 GraphPanel**

使用 `useScreenTheme()`，将 G6 配置改为：

```ts
node: {
  style: {
    fill: theme.value.surfaceSolid,
    stroke: theme.value.accent,
    lineWidth: 2,
    labelFill: theme.value.text,
  },
},
edge: {
  style: {
    stroke: theme.value.line,
    lineWidth: 1,
    endArrow: true,
  },
},
```

面板背景使用：

```css
background:
  radial-gradient(circle, color-mix(in srgb, var(--screen-accent-secondary), transparent 89%), transparent 62%),
  var(--screen-surface);
```

- [ ] **Step 4: 更新 MapPanel 和离线地图**

在 `MapPanel.vue` 中引入并读取主题：

```ts
import { useScreenTheme } from '../../theme/screen-theme'

const theme = useScreenTheme()
```

业务点：

```ts
'circle-color': theme.value.accent,
'circle-stroke-color': theme.value.surfaceSolid,
```

地图覆盖指标卡使用 `var(--screen-surface-solid)`、`var(--screen-text)` 和 `var(--screen-shadow)`。

将 `style-offline.json` 改为浅色：

```json
{
  "background-color": "#eef6f9"
}
```

客户光晕和点颜色改为提醒系统的珊瑚橙与琥珀黄，描边改为 `#fbfdfe`。

- [ ] **Step 5: 运行测试**

```bash
npm test -- --run tests/graph-map-interaction.test.ts
npm run typecheck
```

Expected: 全部通过。

- [ ] **Step 6: 提交关系图和地图适配**

```bash
cd /Users/zhanglei/Documents/codex-new
git add \
  big-screen-center/frontend/src/components/widgets/GraphPanel.vue \
  big-screen-center/frontend/src/components/widgets/MapPanel.vue \
  big-screen-center/frontend/public/assets/maps/style-offline.json \
  big-screen-center/frontend/tests/graph-map-interaction.test.ts
git commit -m "feat(big-screen): brighten graph and map visuals"
```

---

### Task 5: 适配 Three.js 场景与白底交互

**Files:**
- Modify: `big-screen-center/frontend/src/components/widgets/ThreeScene.vue`
- Modify: `big-screen-center/frontend/src/scenes/createOrbitScene.ts`
- Modify: `big-screen-center/frontend/src/scenes/createRiskGlobe.ts`
- Modify: `big-screen-center/frontend/src/scenes/createCourseGalaxy.ts`
- Modify: `big-screen-center/frontend/src/scenes/createExpiryOrbit.ts`
- Modify: `big-screen-center/frontend/tests/scene-interaction.test.ts`

- [ ] **Step 1: 编写容器主题颜色失败测试**

在 `scene-interaction.test.ts` 中给容器写入变量：

```ts
container.style.setProperty('--screen-accent', '#1976ed')
container.style.setProperty('--screen-accent-secondary', '#18b8c9')
container.style.setProperty('--screen-signal', '#29c58b')
container.style.setProperty('--screen-text', '#102a43')
```

扩充 Three mock 记录材质颜色，新增：

```ts
expect(THREE.MeshBasicMaterial).toHaveBeenCalledWith(
  expect.objectContaining({ color: 0x1976ed }),
)
expect(THREE.PointsMaterial).toHaveBeenCalledWith(
  expect.objectContaining({ color: 0x18b8c9 }),
)
```

新增选中状态测试，确认主对象不再设置为纯白：

```ts
expect(material.color.set).toHaveBeenCalledWith(0x1976ed)
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -- --run tests/scene-interaction.test.ts
```

Expected: FAIL，当前场景仍使用各文件硬编码颜色，选中状态仍设置 `0xffffff`。

- [ ] **Step 3: 从容器读取主题颜色**

在 `createOrbitScene.ts` 中增加：

```ts
const cssColorNumber = (
  container: HTMLElement,
  variable: string,
  fallback: number,
) => {
  const raw = getComputedStyle(container).getPropertyValue(variable).trim()
  if (!/^#[0-9a-f]{6}$/i.test(raw)) return fallback
  return Number.parseInt(raw.slice(1), 16)
}
```

将 `OrbitSceneOptions` 改为只保留结构参数：

```ts
interface OrbitSceneOptions {
  ringCount: number
  tilt: number
}
```

场景内部生成：

```ts
const colors = [
  cssColorNumber(container, '--screen-accent', 0x1976ed),
  cssColorNumber(container, '--screen-accent-secondary', 0x18b8c9),
  cssColorNumber(container, '--screen-signal', 0x29c58b),
] as const
```

选中对象保持自身系统主色，通过不透明度 `0.98`、缩放 `1.1` 和更强轮廓表达选中，不能再设置为纯白。

- [ ] **Step 4: 简化三个场景入口并更新面板**

`createRiskGlobe.ts`、`createCourseGalaxy.ts`、`createExpiryOrbit.ts` 只传：

```ts
{
  ringCount: 5,
  tilt: -0.22,
}
```

保留各模板的轨道数量和倾角差异。

`ThreeScene.vue` 面板改为白色透明表面、青蓝径向光晕和浅色边框，标签使用深色标题与蓝灰眉题。

- [ ] **Step 5: 运行场景测试和类型检查**

```bash
npm test -- --run tests/scene-interaction.test.ts
npm run typecheck
```

Expected: 全部通过，WebGL 不可用和 ECharts 降级测试继续通过。

- [ ] **Step 6: 提交 Three.js 适配**

```bash
cd /Users/zhanglei/Documents/codex-new
git add \
  big-screen-center/frontend/src/components/widgets/ThreeScene.vue \
  big-screen-center/frontend/src/scenes/createOrbitScene.ts \
  big-screen-center/frontend/src/scenes/createRiskGlobe.ts \
  big-screen-center/frontend/src/scenes/createCourseGalaxy.ts \
  big-screen-center/frontend/src/scenes/createExpiryOrbit.ts \
  big-screen-center/frontend/tests/scene-interaction.test.ts
git commit -m "feat(big-screen): adapt Three scenes to bright theme"
```

---

### Task 6: 增加 12 模板主题与视觉回归

**Files:**
- Create: `big-screen-center/frontend/e2e/bright-theme.spec.ts`
- Create: `big-screen-center/frontend/e2e/bright-theme.spec.ts-snapshots/*`
- Modify: `big-screen-center/frontend/e2e/degradation.spec.ts`

- [ ] **Step 1: 编写 12 模板主题 E2E**

创建 `e2e/bright-theme.spec.ts`：

```ts
import { expect, test } from '@playwright/test'

import { TEMPLATE_BLUEPRINTS } from '../src/templates/manifests'

for (const [id, systemKey] of TEMPLATE_BLUEPRINTS) {
  test(`${id} uses the bright porcelain theme`, async ({ page }) => {
    await page.addInitScript(() => {
      window.sessionStorage.setItem('big-screen-mock', '1')
      window.sessionStorage.setItem('big-screen-profile', 'medium')
    })
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto(`/play/${id}?mock=1`)

    const canvas = page.locator('[data-screen-ready="true"]')
    await expect(canvas).toHaveAttribute('data-screen-theme', systemKey)
    await expect(canvas).toHaveCSS('color', 'rgb(16, 42, 67)')
    await expect(canvas).not.toHaveCSS('background-color', 'rgb(16, 14, 11)')
    await expect(page.locator('[data-widget-error="true"]')).toHaveCount(0)
    await expect(page.getByText('Sorry, your browser does not support WebGL'))
      .toHaveCount(0)
  })
}
```

- [ ] **Step 2: 验证模板目录和编辑器外壳**

在 `bright-theme.spec.ts` 增加：

```ts
test('catalog and editor use the bright application shell', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light')
  await expect(page.locator('.topline')).toHaveCSS(
    'background-color',
    'rgba(255, 255, 255, 0.94)',
  )
  await expect(page.locator('.template-row').first()).toBeVisible()

  await page.goto('/edit/sca-01?mock=1')
  await expect(page.locator('.screen-editor__grid')).toBeVisible()
  await expect(page.locator('.grid-stack-item-content').first()).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  )
})
```

- [ ] **Step 3: 增加代表性截图测试**

在同一文件增加：

```ts
for (const id of ['sca-01', 'train-02', 'remind-03']) {
  test(`${id} bright visual baseline`, async ({ page }) => {
    await page.addInitScript(() => {
      window.sessionStorage.setItem('big-screen-mock', '1')
      window.sessionStorage.setItem('big-screen-profile', 'medium')
    })
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto(`/play/${id}?mock=1`)
    await expect(page.locator('[data-screen-ready="true"]')).toHaveScreenshot(
      `${id}-bright-widescreen.png`,
      { animations: 'disabled' },
    )

    await page.setViewportSize({ width: 3840, height: 1080 })
    await expect(page.locator('[data-screen-ready="true"]')).toHaveScreenshot(
      `${id}-bright-ultrawide.png`,
      { animations: 'disabled' },
    )
  })
}
```

- [ ] **Step 4: 扩充 WebGL 降级主题断言**

在 `degradation.spec.ts` 的 WebGL 失败用例中增加：

```ts
await expect(page.locator('[data-three-fallback="risk-globe"]')).toBeVisible()
await expect(page.locator('[data-gl-fallback]')).toHaveCount(0)
await expect(page.locator('[data-widget="echart"]')).toHaveCSS(
  'background-color',
  'rgba(0, 0, 0, 0)',
)
await expect(page.getByText('Sorry, your browser does not support WebGL'))
  .toHaveCount(0)
```

- [ ] **Step 5: 运行 12 模板布局与交互检查**

```bash
cd /Users/zhanglei/Documents/codex-new/big-screen-center/frontend
npx playwright test \
  e2e/bright-theme.spec.ts \
  e2e/player-layouts.spec.ts \
  e2e/player-interactions.spec.ts \
  e2e/degradation.spec.ts \
  --update-snapshots
```

Expected:

- 12 套模板主题测试通过。
- 三套代表性模板生成 6 张基准图。
- 原有双布局、联动交互和降级测试通过。

- [ ] **Step 6: 人工检查 6 张基准图**

逐张检查：

- 无深棕黑旧背景。
- 无白底浅字。
- ECharts、G6、地图和 Three.js 不存在暗色孤岛。
- SCA、培训考试、提醒系统强调色可辨识。
- 无英文 WebGL 错误。
- 16:9 和超宽布局无裁切、重叠和溢出。

发现问题时回到对应任务文件修复，并重新生成相关基准图。

- [ ] **Step 7: 提交 E2E 与视觉基准**

```bash
cd /Users/zhanglei/Documents/codex-new
git add \
  big-screen-center/frontend/e2e/bright-theme.spec.ts \
  big-screen-center/frontend/e2e/bright-theme.spec.ts-snapshots \
  big-screen-center/frontend/e2e/degradation.spec.ts
git commit -m "test(big-screen): cover bright theme visual regressions"
```

---

### Task 7: 最终验证、发布和容器更新

**Files:**
- No source changes expected
- Version files are updated automatically by repository hooks

- [ ] **Step 1: 扫描旧主题可见硬编码**

```bash
cd /Users/zhanglei/Documents/codex-new
rg -n \
  "#100e0b|#12100c|#14110d|#201b14|#f2b84b|#f4ead7|#a99b84|#584c3d|#332d25" \
  big-screen-center/frontend/src \
  big-screen-center/frontend/public/assets/maps/style-offline.json
```

Expected: 无可见旧主题硬编码。若仍有结果，逐条确认是测试兼容 fallback 还是必须替换的可见颜色；可见颜色必须清零。

- [ ] **Step 2: 运行前端完整测试**

```bash
cd /Users/zhanglei/Documents/codex-new/big-screen-center/frontend
npm test -- --run
```

Expected: 所有 Vitest 测试通过。

- [ ] **Step 3: 运行类型检查与生产构建**

```bash
npm run typecheck
npm run build
```

Expected: 两条命令退出码为 0。允许现有大 chunk 警告，不允许类型或构建错误。

- [ ] **Step 4: 运行关键 E2E**

```bash
npx playwright test \
  e2e/bright-theme.spec.ts \
  e2e/player-layouts.spec.ts \
  e2e/player-interactions.spec.ts \
  e2e/degradation.spec.ts
```

Expected: 全部通过，截图无差异。

- [ ] **Step 5: 检查 Git 范围**

```bash
cd /Users/zhanglei/Documents/codex-new
git diff --check
git status --short
git diff --stat
```

Expected: 只包含本计划相关文件；现有 `.superpowers/`、压缩包、测试输出、缓存和其他未跟踪文件不暂存、不删除。

- [ ] **Step 6: 确认远端分支**

```bash
git status --short --branch
git log -3 --oneline --decorate
git ls-remote --heads origin "$(git branch --show-current)"
```

Expected: 当前分支与远端一致，远端提交哈希等于本地 `HEAD`。

- [ ] **Step 7: 只重建大屏前端容器**

```bash
docker compose up -d --build --no-deps web-big-screen
```

Expected: 构建使用最新版本，`codex-new-web-big-screen-1` 被重建并启动。

- [ ] **Step 8: 验证运行容器**

```bash
docker inspect -f '{{.State.Status}} {{.State.Running}} {{.Image}}' \
  codex-new-web-big-screen-1
curl -fsS http://127.0.0.1:18092/ >/dev/null
```

Expected:

- 容器输出 `running true`。
- HTTP 请求退出码为 0。
- 浏览器强制刷新后 12 套模板使用最新“云端白瓷”主题。
