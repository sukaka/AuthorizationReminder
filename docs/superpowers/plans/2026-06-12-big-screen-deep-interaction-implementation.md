# Big Screen Deep Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为统一大屏中心的 12 套模板增加模板内悬停预览、点击锁定、多组件联动、底部分析台和安全业务跳转。

**Architecture:** `ScreenPlayer` 提供模板级交互上下文，组件只上报带业务指标键的 `InteractionTarget`，不直接互相调用。DOM、ECharts、G6、MapLibre 和 Three.js 分别实现轻量适配器；模板清单保存中文指标元数据和关联规则，纯函数控制器负责状态转换、刷新恢复和性能降级。

**Tech Stack:** Vue 3.5、TypeScript 6、Vitest、Vue Test Utils、Playwright、Apache ECharts 6、AntV G6 5、MapLibre GL JS 5、Three.js 0.184、Zod。

---

## 实施约束

- 设计依据：`docs/superpowers/specs/2026-06-12-big-screen-deep-interaction-design.md`
- 用户明确要求在主目录 `/Users/zhanglei/Documents/codex-new` 工作，不创建 worktree。
- 不添加新的图表、动效或状态管理依赖。
- 不使用假业务坐标；地图数据没有 GeoJSON 时只展示可交互的聚合指标，不伪造客户点位。
- 本计划文档提交后实施起始版本为 `5.70.11`；中间任务使用 `CODEX_VERSIONING_BYPASS=1` 提交，最终功能提交正常触发一次 minor 升级：`5.70.11 -> 5.71.0`。
- 每次只暂存本任务列出的文件，忽略 `.superpowers/`、构建目录、压缩包和用户现有未跟踪文件。

## 文件结构

### 新增文件

| 文件 | 职责 |
| --- | --- |
| `big-screen-center/frontend/src/interactions/metric-interactions.ts` | 为 12 套模板生成中文指标元数据、分组和关联键 |
| `big-screen-center/frontend/src/interactions/screen-interaction.ts` | 纯函数交互状态机、刷新恢复和关联计算 |
| `big-screen-center/frontend/src/interactions/useScreenInteraction.ts` | Vue `provide/inject` 适配层和组件目标构造 |
| `big-screen-center/frontend/src/interactions/business-navigation.ts` | 业务系统地址、路径白名单、查询参数过滤和安全打开 |
| `big-screen-center/frontend/src/components/InteractionConsole.vue` | 底部联动分析台 |
| `big-screen-center/frontend/tests/interaction-manifests.test.ts` | 12 套模板交互元数据测试 |
| `big-screen-center/frontend/tests/screen-interaction.test.ts` | 状态机测试 |
| `big-screen-center/frontend/tests/business-navigation.test.ts` | 业务跳转安全测试 |
| `big-screen-center/frontend/tests/helpers/interaction.ts` | 组件测试使用的交互 provider 和状态辅助函数 |
| `big-screen-center/frontend/tests/interactive-widgets.test.ts` | DOM 组件交互测试 |
| `big-screen-center/frontend/tests/echart-interaction.test.ts` | ECharts 事件和反向高亮测试 |
| `big-screen-center/frontend/tests/scene-interaction.test.ts` | Three.js 场景协议和清理测试 |
| `big-screen-center/frontend/e2e/player-interactions.spec.ts` | 12 模板浏览器交互验收 |

### 修改文件

| 文件 | 修改内容 |
| --- | --- |
| `big-screen-center/frontend/src/types.ts` | 增加交互类型并扩展 `ScreenTemplate` |
| `big-screen-center/frontend/src/templates/manifests.ts` | 为每套模板挂载交互元数据 |
| `big-screen-center/backend/src/contracts.ts` | 同步模板交互元数据 Zod 契约 |
| `big-screen-center/backend/src/catalog.ts` | 后端目录同步交互元数据 |
| `big-screen-center/backend/tests/catalog.test.ts` | 校验安全路径和模板交互定义 |
| `big-screen-center/frontend/src/components/ScreenPlayer.vue` | 提供上下文、空白清除、Esc、刷新恢复和分析台 |
| `big-screen-center/frontend/src/components/widgets/WidgetHost.vue` | 向异步组件透传模板上下文所需属性 |
| `big-screen-center/frontend/src/components/widgets/MetricCards.vue` | 卡片悬停、键盘选择和锁定样式 |
| `big-screen-center/frontend/src/components/widgets/RankingTable.vue` | 排行行交互 |
| `big-screen-center/frontend/src/components/widgets/StatusMatrix.vue` | 健康格交互和清晰状态图例 |
| `big-screen-center/frontend/src/components/widgets/EChartPanel.vue` | ECharts 原生事件和 `dispatchAction` 联动 |
| `big-screen-center/frontend/src/components/widgets/GraphPanel.vue` | G6 节点状态和画布清除 |
| `big-screen-center/frontend/src/components/widgets/MapPanel.vue` | GeoJSON 要素或聚合指标交互 |
| `big-screen-center/frontend/src/components/widgets/ThreeScene.vue` | 场景交互回调和上下文同步 |
| `big-screen-center/frontend/src/registry/scenes.ts` | 扩展 `ManagedScene` 协议 |
| `big-screen-center/frontend/src/scenes/createOrbitScene.ts` | Raycaster 命中、选中反馈和事件释放 |
| `big-screen-center/frontend/Dockerfile` | 注入三个业务系统前端基础地址 |
| `docker-compose.yml` | 配置业务系统前端地址构建参数 |
| `big-screen-center/frontend/e2e/player-layouts.spec.ts` | 增加分析台关闭状态断言 |

## Task 1: 定义模板交互契约和 12 套模板元数据

**Files:**
- Create: `big-screen-center/frontend/src/interactions/metric-interactions.ts`
- Modify: `big-screen-center/frontend/src/types.ts`
- Modify: `big-screen-center/frontend/src/templates/manifests.ts`
- Modify: `big-screen-center/frontend/tests/manifests.test.ts`
- Create: `big-screen-center/frontend/tests/interaction-manifests.test.ts`
- Modify: `big-screen-center/backend/src/contracts.ts`
- Modify: `big-screen-center/backend/src/catalog.ts`
- Modify: `big-screen-center/backend/tests/catalog.test.ts`

- [ ] **Step 1: 写前后端契约失败测试**

在 `interaction-manifests.test.ts` 中加入：

```ts
import { describe, expect, it } from 'vitest'

import { screenManifests } from '../src/templates/manifests'

describe('template interaction manifests', () => {
  it('defines Chinese interaction metadata for all twelve templates', () => {
    expect(screenManifests).toHaveLength(12)
    for (const template of screenManifests) {
      expect(template.interactions.length).toBeGreaterThanOrEqual(8)
      expect(new Set(template.interactions.map((item) => item.key)).size)
        .toBe(template.interactions.length)
      for (const item of template.interactions) {
        expect(item.label).toMatch(/[\u4e00-\u9fff]/)
        expect(item.description).toMatch(/[\u4e00-\u9fff]/)
        expect(item.detailPath).toBe('/')
        expect(item.relatedKeys).not.toContain(item.key)
      }
    }
  })

  it('keeps every related key inside its template catalog', () => {
    for (const template of screenManifests) {
      const keys = new Set(template.interactions.map((item) => item.key))
      for (const item of template.interactions) {
        for (const related of item.relatedKeys) expect(keys.has(related)).toBe(true)
      }
    }
  })
})
```

在 `backend/tests/catalog.test.ts` 中增加：

```ts
it('accepts only relative whitelisted interaction paths', () => {
  const parsed = ScreenTemplateSchema.parse(screenCatalog[0])
  expect(parsed.interactions.length).toBeGreaterThan(0)
  expect(parsed.interactions.every((item) => item.detailPath === '/')).toBe(true)

  expect(() => ScreenTemplateSchema.parse({
    ...screenCatalog[0],
    interactions: [{
      key: 'criticalRisks',
      label: '严重风险',
      group: 'risk',
      relatedKeys: [],
      detailPath: 'javascript:alert(1)',
      description: '严重风险数量',
    }],
  })).toThrow()
})
```

同时给该测试文件已有的 `baseTemplate` 增加最小合法定义，避免既有契约测试因新增必填字段失效：

```ts
interactions: [{
  key: 'criticalRisks',
  label: '严重风险',
  group: 'risk',
  relatedKeys: [],
  detailPath: '/',
  description: '严重风险数量',
}],
```

- [ ] **Step 2: 运行测试并确认缺少 `interactions`**

Run:

```bash
npm --prefix big-screen-center/frontend test -- --run tests/interaction-manifests.test.ts
npm --prefix big-screen-center/backend test -- --run tests/catalog.test.ts
```

Expected: FAIL，`ScreenTemplate` 和目录对象尚无 `interactions`。

- [ ] **Step 3: 增加类型、元数据生成器和安全后端契约**

在前端 `types.ts` 增加：

```ts
export type InteractionSource =
  | 'metric-card'
  | 'echart'
  | 'ranking'
  | 'status-matrix'
  | 'graph'
  | 'map'
  | 'three'

export interface MetricInteractionDefinition {
  key: string
  label: string
  group: string
  relatedKeys: string[]
  detailPath: string
  description: string
}

export interface InteractionTarget extends MetricInteractionDefinition {
  value?: number | string
  unit?: string
  source: InteractionSource
  sourceWidgetId: string
  templateId: string
  filters: Record<string, string | number | boolean>
}

export interface InteractionSnapshot {
  hovered: InteractionTarget | null
  locked: InteractionTarget | null
}
```

并在 `ScreenTemplate` 增加：

```ts
interactions: MetricInteractionDefinition[]
```

创建 `metric-interactions.ts`：

```ts
import { metricLabel } from '../metric-labels'
import type {
  MetricInteractionDefinition,
  SystemKey,
} from '../types'

const keysBySystem: Record<SystemKey, string[]> = {
  sca: [
    'project_count', 'component_total', 'vulnerability_total', 'criticalRisks',
    'high', 'medium', 'low', 'vulnerableComponents', 'healthyRate',
    'blocked_count', 'assets', 'devops',
  ],
  'train-exam': [
    'course_total', 'question_total', 'question_published_total',
    'question_draft_total', 'paper_total', 'paper_published_total', 'exam_total',
    'final_result_total', 'final_passed_total', 'pass_rate', 'activeCourses',
    'learners', 'completionRate', 'certificates',
  ],
  reminder: [
    'expiring', 'todayDue', 'totalReminders', 'successRate', 'total', 'success',
    'channelBreakdown_sms_total', 'expiring7d', 'expiring30d', 'riskAmount',
    'deliveryRate', 'day7', 'day30', 'day60', 'day90', 'customer_count',
    'license_count',
  ],
}

const groupByKey: Record<string, string> = {
  project_count: 'asset', component_total: 'asset', assets: 'asset',
  vulnerability_total: 'risk', criticalRisks: 'risk', high: 'risk',
  medium: 'risk', low: 'risk', vulnerableComponents: 'risk',
  healthyRate: 'governance', blocked_count: 'governance', devops: 'governance',
  course_total: 'content', question_total: 'content',
  question_published_total: 'content', question_draft_total: 'content',
  paper_total: 'content', paper_published_total: 'content',
  exam_total: 'exam', final_result_total: 'exam', final_passed_total: 'exam',
  pass_rate: 'outcome', activeCourses: 'content', learners: 'learner',
  completionRate: 'outcome', certificates: 'outcome',
  expiring: 'expiry', todayDue: 'expiry', expiring7d: 'expiry',
  expiring30d: 'expiry', day7: 'expiry', day30: 'expiry', day60: 'expiry',
  day90: 'expiry', riskAmount: 'expiry', totalReminders: 'delivery',
  successRate: 'delivery', total: 'delivery', success: 'delivery',
  channelBreakdown_sms_total: 'delivery', deliveryRate: 'delivery',
  customer_count: 'customer', license_count: 'customer',
}

export const createMetricInteractions = (
  systemKey: SystemKey,
): MetricInteractionDefinition[] => {
  const keys = keysBySystem[systemKey]
  return keys.map((key) => {
    const group = groupByKey[key]
    return {
      key,
      label: metricLabel(key),
      group,
      relatedKeys: keys.filter(
        (candidate) => candidate !== key && groupByKey[candidate] === group,
      ),
      detailPath: '/',
      description: `${metricLabel(key)}用于展示当前模板中的${metricLabel(key)}业务状态。`,
    }
  })
}
```

在前端 `manifests.ts` 返回对象中增加：

```ts
interactions: createMetricInteractions(systemKey),
```

后端 `contracts.ts` 增加：

```ts
export const MetricInteractionSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
  label: z.string().min(1).max(40),
  group: z.string().regex(/^[a-z][a-z0-9-]*$/),
  relatedKeys: z.array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/)),
  detailPath: z.string().regex(/^\/(?:[a-zA-Z0-9/_-]*)?$/),
  description: z.string().min(2).max(160),
})
```

在 `ScreenTemplateSchema` 增加：

```ts
interactions: z.array(MetricInteractionSchema).min(1),
```

在 `backend/src/catalog.ts` 使用与前端相同的键、分组和关联生成规则，为 `createTemplate` 返回对象增加 `interactions`。后端不复制中文翻译算法，使用一个明确的 `Record<string, string>` 中文标签表；标签表覆盖上述所有键。

- [ ] **Step 4: 运行契约测试**

Run:

```bash
npm --prefix big-screen-center/frontend test -- --run tests/manifests.test.ts tests/interaction-manifests.test.ts
npm --prefix big-screen-center/backend test -- --run tests/catalog.test.ts
npm --prefix big-screen-center/frontend run typecheck
npm --prefix big-screen-center/backend run typecheck
```

Expected: PASS，12 套模板均有合法中文交互元数据。

- [ ] **Step 5: 提交契约与元数据**

```bash
git add big-screen-center/frontend/src/types.ts \
  big-screen-center/frontend/src/interactions/metric-interactions.ts \
  big-screen-center/frontend/src/templates/manifests.ts \
  big-screen-center/frontend/tests/manifests.test.ts \
  big-screen-center/frontend/tests/interaction-manifests.test.ts \
  big-screen-center/backend/src/contracts.ts \
  big-screen-center/backend/src/catalog.ts \
  big-screen-center/backend/tests/catalog.test.ts
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(big-screen): define template interaction metadata"
```

## Task 2: 实现纯函数交互状态机

**Files:**
- Create: `big-screen-center/frontend/src/interactions/screen-interaction.ts`
- Create: `big-screen-center/frontend/tests/screen-interaction.test.ts`

- [ ] **Step 1: 写悬停、锁定、切换、刷新和关联失败测试**

```ts
import { describe, expect, it } from 'vitest'

import { createScreenInteractionController } from '../src/interactions/screen-interaction'
import type { InteractionTarget } from '../src/types'

const target = (
  key: string,
  relatedKeys: string[] = [],
  value = 1,
): InteractionTarget => ({
  key,
  label: key,
  group: 'risk',
  relatedKeys,
  detailPath: '/',
  description: `${key}说明`,
  value,
  source: 'metric-card',
  sourceWidgetId: 'metrics',
  templateId: 'sca-01',
  filters: {},
})

describe('screen interaction controller', () => {
  it('restores the locked target after hover leaves', () => {
    const controller = createScreenInteractionController()
    controller.lock(target('high', ['criticalRisks']))
    controller.hover(target('medium'))
    expect(controller.active()?.key).toBe('medium')
    controller.leave()
    expect(controller.active()?.key).toBe('high')
  })

  it('classifies primary, related, and unrelated keys', () => {
    const controller = createScreenInteractionController()
    controller.lock(target('high', ['criticalRisks']))
    expect(controller.relationFor('high')).toBe('primary')
    expect(controller.relationFor('criticalRisks')).toBe('related')
    expect(controller.relationFor('project_count')).toBe('none')
  })

  it('updates a locked value after refresh and clears a missing target', () => {
    const controller = createScreenInteractionController()
    controller.lock(target('high', [], 2))
    controller.refresh({ high: 7 })
    expect(controller.snapshot().locked?.value).toBe(7)
    controller.refresh({ medium: 4 })
    expect(controller.snapshot().locked).toBeNull()
  })
})
```

- [ ] **Step 2: 运行测试并确认模块不存在**

Run:

```bash
npm --prefix big-screen-center/frontend test -- --run tests/screen-interaction.test.ts
```

Expected: FAIL，无法导入 `screen-interaction`。

- [ ] **Step 3: 实现状态机**

创建 `screen-interaction.ts`：

```ts
import type {
  InteractionSnapshot,
  InteractionTarget,
  JsonValue,
} from '../types'

export type InteractionRelation = 'primary' | 'related' | 'none'

const numericValue = (data: JsonValue, key: string): number | undefined => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined
  const value = data[key]
  return typeof value === 'number' ? value : undefined
}

export const createScreenInteractionController = (
  onChange: (snapshot: InteractionSnapshot) => void = () => undefined,
) => {
  let state: InteractionSnapshot = { hovered: null, locked: null }

  const publish = () => {
    const next = { ...state }
    onChange(next)
    return next
  }

  return {
    snapshot: () => ({ ...state }),
    active: () => state.hovered || state.locked,
    hover(target: InteractionTarget) {
      state = { ...state, hovered: target }
      return publish()
    },
    leave() {
      state = { ...state, hovered: null }
      return publish()
    },
    lock(target: InteractionTarget) {
      state = { hovered: null, locked: target }
      return publish()
    },
    clear() {
      state = { hovered: null, locked: null }
      return publish()
    },
    relationFor(key: string): InteractionRelation {
      const active = state.hovered || state.locked
      if (!active) return 'none'
      if (active.key === key) return 'primary'
      return active.relatedKeys.includes(key) ? 'related' : 'none'
    },
    refresh(data: JsonValue) {
      if (!state.locked) return publish()
      const value = numericValue(data, state.locked.key)
      if (value === undefined) {
        state = { hovered: null, locked: null }
      } else {
        state = {
          hovered: null,
          locked: { ...state.locked, value },
        }
      }
      return publish()
    },
  }
}
```

- [ ] **Step 4: 运行状态机测试**

Run:

```bash
npm --prefix big-screen-center/frontend test -- --run tests/screen-interaction.test.ts
npm --prefix big-screen-center/frontend run typecheck
```

Expected: PASS。

- [ ] **Step 5: 提交状态机**

```bash
git add big-screen-center/frontend/src/interactions/screen-interaction.ts \
  big-screen-center/frontend/tests/screen-interaction.test.ts
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(big-screen): add template interaction state machine"
```

## Task 3: 实现安全业务跳转

**Files:**
- Create: `big-screen-center/frontend/src/interactions/business-navigation.ts`
- Create: `big-screen-center/frontend/tests/business-navigation.test.ts`
- Modify: `big-screen-center/frontend/Dockerfile`
- Modify: `docker-compose.yml`

- [ ] **Step 1: 写路径白名单和安全打开失败测试**

```ts
import { describe, expect, it, vi } from 'vitest'

import {
  buildBusinessDetailUrl,
  openBusinessDetail,
} from '../src/interactions/business-navigation'

describe('business navigation', () => {
  it('uses the configured system origin and filters context parameters', () => {
    expect(buildBusinessDetailUrl({
      systemKey: 'sca',
      detailPath: '/',
      currentHref: 'http://127.0.0.1:18092/play/sca-01',
      context: {
        metric: 'criticalRisks',
        dateRange: '30d',
        token: 'secret',
      },
    })).toBe(
      'http://127.0.0.1:18089/?metric=criticalRisks&dateRange=30d',
    )
  })

  it.each(['javascript:alert(1)', '//evil.example/a', 'https://evil.example/a'])(
    'rejects unsafe detail path %s',
    (detailPath) => {
      expect(() => buildBusinessDetailUrl({
        systemKey: 'reminder',
        detailPath,
        currentHref: 'http://localhost:18092/play/remind-01',
        context: {},
      })).toThrow('业务详情路径不在白名单中')
    },
  )

  it('opens a new tab without opener or referrer', () => {
    const open = vi.fn()
    openBusinessDetail(
      {
        systemKey: 'train-exam',
        detailPath: '/',
        currentHref: 'http://localhost:18092/play/train-01',
        context: { metric: 'course_total' },
      },
      open,
    )
    expect(open).toHaveBeenCalledWith(
      'http://localhost:18087/?metric=course_total',
      '_blank',
      'noopener,noreferrer',
    )
  })
})
```

- [ ] **Step 2: 运行测试并确认模块不存在**

Run:

```bash
npm --prefix big-screen-center/frontend test -- --run tests/business-navigation.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现地址解析、白名单和构建参数**

创建 `business-navigation.ts`：

```ts
import type { SystemKey } from '../types'

interface BuildBusinessDetailInput {
  systemKey: SystemKey
  detailPath: string
  currentHref: string
  context: Record<string, unknown>
}

const allowedContextKeys = new Set([
  'metric',
  'dateRange',
  'projectId',
  'category',
])

const configuredOrigins: Partial<Record<SystemKey, string>> = {
  sca: import.meta.env.VITE_SCA_APP_URL,
  'train-exam': import.meta.env.VITE_TRAIN_EXAM_APP_URL,
  reminder: import.meta.env.VITE_REMINDER_APP_URL,
}

const localPorts: Record<SystemKey, string> = {
  sca: '18089',
  'train-exam': '18087',
  reminder: '18080',
}

const allowedPaths: Record<SystemKey, Set<string>> = {
  sca: new Set(['/']),
  'train-exam': new Set(['/']),
  reminder: new Set(['/']),
}

const resolveOrigin = (systemKey: SystemKey, currentHref: string) => {
  const configured = configuredOrigins[systemKey]
  if (configured) return new URL(configured).origin
  const current = new URL(currentHref)
  if (['localhost', '127.0.0.1', '::1'].includes(current.hostname)) {
    return `${current.protocol}//${current.hostname}:${localPorts[systemKey]}`
  }
  return current.origin
}

export const buildBusinessDetailUrl = ({
  systemKey,
  detailPath,
  currentHref,
  context,
}: BuildBusinessDetailInput) => {
  if (!allowedPaths[systemKey].has(detailPath)) {
    throw new Error('业务详情路径不在白名单中')
  }
  const url = new URL(detailPath, resolveOrigin(systemKey, currentHref))
  for (const [key, value] of Object.entries(context)) {
    if (!allowedContextKeys.has(key)) continue
    if (!['string', 'number', 'boolean'].includes(typeof value)) continue
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

export const openBusinessDetail = (
  input: BuildBusinessDetailInput,
  open: typeof window.open = window.open.bind(window),
) => {
  open(buildBusinessDetailUrl(input), '_blank', 'noopener,noreferrer')
}
```

在 `Dockerfile` build stage 增加：

```dockerfile
ARG VITE_SCA_APP_URL
ARG VITE_TRAIN_EXAM_APP_URL
ARG VITE_REMINDER_APP_URL
ENV VITE_SCA_APP_URL=${VITE_SCA_APP_URL}
ENV VITE_TRAIN_EXAM_APP_URL=${VITE_TRAIN_EXAM_APP_URL}
ENV VITE_REMINDER_APP_URL=${VITE_REMINDER_APP_URL}
```

在 `docker-compose.yml` 的 `web-big-screen.build` 增加：

```yaml
args:
  <<: *build_args_node_alpine_nginx
  VITE_SCA_APP_URL: ${VITE_SCA_APP_URL:-http://localhost:18089}
  VITE_TRAIN_EXAM_APP_URL: ${VITE_TRAIN_EXAM_APP_URL:-http://localhost:18087}
  VITE_REMINDER_APP_URL: ${VITE_REMINDER_APP_URL:-http://localhost:18080}
```

- [ ] **Step 4: 运行跳转和 Compose 配置测试**

Run:

```bash
npm --prefix big-screen-center/frontend test -- --run tests/business-navigation.test.ts
npm --prefix big-screen-center/frontend run typecheck
docker compose config --quiet
```

Expected: PASS，危险路径被拒绝，令牌字段被过滤。

- [ ] **Step 5: 提交业务跳转**

```bash
git add big-screen-center/frontend/src/interactions/business-navigation.ts \
  big-screen-center/frontend/tests/business-navigation.test.ts \
  big-screen-center/frontend/Dockerfile \
  docker-compose.yml
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(big-screen): add safe business navigation"
```

## Task 4: 提供 Vue 交互上下文并实现底部分析台

**Files:**
- Create: `big-screen-center/frontend/src/interactions/useScreenInteraction.ts`
- Create: `big-screen-center/frontend/src/components/InteractionConsole.vue`
- Modify: `big-screen-center/frontend/src/components/ScreenPlayer.vue`
- Modify: `big-screen-center/frontend/src/components/widgets/WidgetHost.vue`
- Create: `big-screen-center/frontend/tests/helpers/interaction.ts`
- Create: `big-screen-center/frontend/tests/interaction-console.test.ts`

- [ ] **Step 1: 写分析台和 Esc 清除失败测试**

测试挂载 `ScreenPlayer` 时 mock `useDataChannel` 和异步组件，断言：

```ts
it('opens the console for a locked target and closes it with Escape', async () => {
  const wrapper = mount(ScreenPlayer, {
    props: { template: screenManifests[0] },
    global: { plugins: [router] },
  })

  await wrapper.get('[data-interaction-key="criticalRisks"]').trigger('click')
  expect(wrapper.get('[data-interaction-console]').text()).toContain('严重风险')

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  await nextTick()
  expect(wrapper.find('[data-interaction-console]').exists()).toBe(false)
})
```

分析台组件测试加入：

```ts
it('hides an invalid business link and emits close', async () => {
  const wrapper = mount(InteractionConsole, {
    props: {
      target: {
        key: 'criticalRisks',
        label: '严重风险',
        group: 'risk',
        relatedKeys: [],
        detailPath: 'javascript:alert(1)',
        description: '严重风险数量',
        value: 48,
        source: 'metric-card',
        sourceWidgetId: 'sca-01-metrics',
        templateId: 'sca-01',
        filters: {},
      },
      related: [],
      systemKey: 'sca',
    },
  })

  expect(wrapper.find('[data-business-detail]').exists()).toBe(false)
  await wrapper.get('[aria-label="关闭联动分析台"]').trigger('click')
  expect(wrapper.emitted('close')).toHaveLength(1)
})
```

- [ ] **Step 2: 运行测试并确认分析台不存在**

Run:

```bash
npm --prefix big-screen-center/frontend test -- --run tests/interaction-console.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现 provider、目标构造和分析台**

`useScreenInteraction.ts` 导出：

```ts
import {
  computed,
  inject,
  provide,
  ref,
  watch,
  type ComputedRef,
  type InjectionKey,
  type Ref,
} from 'vue'

import { metricLabel } from '../metric-labels'
import type {
  InteractionSnapshot,
  InteractionSource,
  InteractionTarget,
  JsonValue,
  ScreenTemplate,
  WidgetDefinition,
} from '../types'
import {
  createScreenInteractionController,
  type InteractionRelation,
} from './screen-interaction'

export interface ScreenInteractionApi {
  snapshot: Readonly<Ref<InteractionSnapshot>>
  active: ComputedRef<InteractionTarget | null>
  hover(target: InteractionTarget): void
  leave(): void
  lock(target: InteractionTarget): void
  clear(): void
  relationFor(key: string): InteractionRelation
  targetFor(
    widget: WidgetDefinition,
    key: string,
    value?: number | string,
    source?: InteractionSource,
  ): InteractionTarget
}

export const screenInteractionKey: InjectionKey<ScreenInteractionApi> =
  Symbol('screen-interaction')

export const provideScreenInteraction = (
  template: Ref<ScreenTemplate>,
  data: Ref<JsonValue>,
  filters: Ref<Record<string, JsonValue>>,
): ScreenInteractionApi => {
  const snapshot = ref<InteractionSnapshot>({ hovered: null, locked: null })
  const controller = createScreenInteractionController(
    (next) => { snapshot.value = next },
  )
  const definitions = computed(() =>
    new Map(template.value.interactions.map((item) => [item.key, item])),
  )

  watch(data, (next) => controller.refresh(next), { deep: true })

  const api: ScreenInteractionApi = {
    snapshot,
    active: computed(() => snapshot.value.hovered || snapshot.value.locked),
    hover: controller.hover,
    leave: controller.leave,
    lock: controller.lock,
    clear: controller.clear,
    relationFor: controller.relationFor,
    targetFor(widget, key, value, source = 'metric-card') {
      const definition = definitions.value.get(key) || {
        key,
        label: metricLabel(key),
        group: 'other',
        relatedKeys: [],
        detailPath: '/',
        description: `${metricLabel(key)}的当前业务数据。`,
      }
      return {
        ...definition,
        value,
        unit: key.toLowerCase().includes('rate') ? '%' : undefined,
        source,
        sourceWidgetId: widget.id,
        templateId: template.value.id,
        filters: Object.fromEntries(
          Object.entries(filters.value).filter(
            (entry): entry is [string, string | number | boolean] =>
              ['string', 'number', 'boolean'].includes(typeof entry[1]),
          ),
        ),
      }
    },
  }
  provide(screenInteractionKey, api)
  return api
}

export const useScreenInteraction = () => {
  const interaction = inject(screenInteractionKey)
  if (!interaction) {
    throw new Error('Screen interaction provider is missing')
  }
  return interaction
}
```

`InteractionConsole.vue` 接收 `target`、`related`、`systemKey`，发出 `close`。组件用 `buildBusinessDetailUrl` 的成功结果计算 `detailUrl`；路径校验抛错时返回 `null` 并隐藏业务按钮，合法时通过 `openBusinessDetail` 打开：

```vue
<template>
  <Transition name="interaction-console">
    <aside
      v-if="target"
      class="interaction-console"
      data-interaction-console
      aria-live="polite"
    >
      <section>
        <span>当前指标</span>
        <strong>{{ target.label }}</strong>
        <b>{{ target.value ?? '暂无' }}{{ target.unit }}</b>
      </section>
      <section>
        <span>指标说明</span>
        <p>{{ target.description }}</p>
      </section>
      <section>
        <span>关联指标</span>
        <p>{{ related.map((item) => item.label).join('、') || '暂无关联指标' }}</p>
      </section>
      <button
        v-if="detailUrl"
        type="button"
        data-business-detail
        @click="openDetail"
      >
        前往业务系统
      </button>
      <button type="button" aria-label="关闭联动分析台" @click="$emit('close')">关闭</button>
    </aside>
  </Transition>
</template>
```

标准屏高度 `150px`，超宽屏高度 `190px`；进入过渡 `320ms`，`prefers-reduced-motion` 下过渡接近零。

在 `ScreenPlayer.vue`：

- 用 `toRef(props, 'template')` 和现有 `data`、`filters` 调用 provider。
- `screen-canvas` 监听空白点击，仅当 `event.target === event.currentTarget` 或目标命中 `[data-screen-clear-area]` 时清除。
- `window` 注册 `keydown`，`Esc` 调用 `clear()`，卸载时移除。
- 在 `.screen-grid` 后渲染 `InteractionConsole`。
- 分析台相关指标从 `template.interactions` 中按 `active.relatedKeys` 解析，并从当前数据取数。

`WidgetHost.vue` 不新增跨组件事件总线，只确保异步组件位于 provider 后代树中。

创建 `tests/helpers/interaction.ts`，供后续组件测试复用：

```ts
import { mount, type ComponentMountingOptions } from '@vue/test-utils'
import { computed, ref } from 'vue'
import type { Component } from 'vue'

import { metricLabel } from '../../src/metric-labels'
import {
  screenInteractionKey,
  type ScreenInteractionApi,
} from '../../src/interactions/useScreenInteraction'
import type {
  InteractionTarget,
  WidgetDefinition,
} from '../../src/types'

export const mountWithInteraction = (
  component: Component,
  props: Record<string, unknown>,
  options: ComponentMountingOptions<Component> = {},
) => {
  const snapshot = ref({ hovered: null, locked: null } as {
    hovered: InteractionTarget | null
    locked: InteractionTarget | null
  })
  const active = computed(() => snapshot.value.hovered || snapshot.value.locked)

  const api: ScreenInteractionApi = {
    snapshot,
    active,
    hover(target) {
      snapshot.value = { ...snapshot.value, hovered: target }
    },
    leave() {
      snapshot.value = { ...snapshot.value, hovered: null }
    },
    lock(target) {
      snapshot.value = { hovered: null, locked: target }
    },
    clear() {
      snapshot.value = { hovered: null, locked: null }
    },
    relationFor(key) {
      if (active.value?.key === key) return 'primary'
      if (active.value?.relatedKeys.includes(key)) return 'related'
      return 'none'
    },
    targetFor(widget: WidgetDefinition, key, value, source = 'metric-card') {
      return {
        key,
        label: metricLabel(key),
        group: 'test',
        relatedKeys: [],
        detailPath: '/',
        description: `${metricLabel(key)}测试说明`,
        value,
        source,
        sourceWidgetId: widget.id,
        templateId: 'sca-01',
        filters: {},
      }
    },
  }

  const wrapper = mount(component, {
    ...options,
    props,
    global: {
      ...options.global,
      provide: {
        ...options.global?.provide,
        [screenInteractionKey as symbol]: api,
      },
    },
  })
  return { wrapper, api }
}
```

- [ ] **Step 4: 运行分析台测试和类型检查**

Run:

```bash
npm --prefix big-screen-center/frontend test -- --run \
  tests/screen-interaction.test.ts \
  tests/interaction-console.test.ts
npm --prefix big-screen-center/frontend run typecheck
```

Expected: PASS。

- [ ] **Step 5: 提交上下文和分析台**

```bash
git add big-screen-center/frontend/src/interactions/useScreenInteraction.ts \
  big-screen-center/frontend/src/components/InteractionConsole.vue \
  big-screen-center/frontend/src/components/ScreenPlayer.vue \
  big-screen-center/frontend/src/components/widgets/WidgetHost.vue \
  big-screen-center/frontend/tests/helpers/interaction.ts \
  big-screen-center/frontend/tests/interaction-console.test.ts
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(big-screen): add linked analysis console"
```

## Task 5: 接入指标卡、排行和数据健康矩阵

**Files:**
- Modify: `big-screen-center/frontend/src/components/widgets/MetricCards.vue`
- Modify: `big-screen-center/frontend/src/components/widgets/RankingTable.vue`
- Modify: `big-screen-center/frontend/src/components/widgets/StatusMatrix.vue`
- Create: `big-screen-center/frontend/tests/interactive-widgets.test.ts`
- Modify: `big-screen-center/frontend/tests/status-matrix-labels.test.ts`

- [ ] **Step 1: 写 DOM 组件交互失败测试**

使用一个测试 provider 包装组件并断言：

```ts
it('previews, locks, and exposes keyboard selection on metric cards', async () => {
  const { wrapper } = mountWithInteraction(MetricCards, {
    widget,
    data: { criticalRisks: 48, high: 12 },
    performanceProfile: 'high',
  })
  const card = wrapper.get('[data-interaction-key="criticalRisks"]')

  await card.trigger('mouseenter')
  expect(card.attributes('data-interaction-state')).toBe('primary')
  await card.trigger('mouseleave')
  expect(card.attributes('data-interaction-state')).toBe('none')
  await card.trigger('keydown', { key: 'Enter' })
  expect(card.attributes('aria-pressed')).toBe('true')
})

it('keeps unrelated ranking rows unchanged', async () => {
  const { wrapper, api } = mountWithInteraction(RankingTable, props)
  api.lock(api.targetFor(widget, 'criticalRisks', 48, 'ranking'))
  await nextTick()
  expect(wrapper.get('[data-interaction-key="project_count"]')
    .attributes('data-interaction-state')).toBe('none')
})
```

状态矩阵测试断言每格有中文 `aria-label`，并存在“正常 / 关注 / 暂无数据”图例。

- [ ] **Step 2: 运行测试并确认元素没有交互属性**

Run:

```bash
npm --prefix big-screen-center/frontend test -- --run \
  tests/interactive-widgets.test.ts \
  tests/status-matrix-labels.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 为三个 DOM 组件接入统一 API**

三个组件统一使用：

```ts
const interaction = useScreenInteraction()
const relation = (key: string) => interaction.relationFor(key)
const select = (key: string, value: number, source: InteractionSource) =>
  interaction.lock(interaction.targetFor(props.widget, key, value, source))
const preview = (key: string, value: number, source: InteractionSource) =>
  interaction.hover(interaction.targetFor(props.widget, key, value, source))
```

每个可交互元素增加：

```vue
:data-interaction-key="item.key"
:data-interaction-state="relation(item.key)"
:aria-pressed="interaction.snapshot.value.locked?.key === item.key"
tabindex="0"
@mouseenter="preview(item.key, item.value, source)"
@mouseleave="interaction.leave()"
@click.stop="select(item.key, item.value, source)"
@keydown.enter.prevent="select(item.key, item.value, source)"
@keydown.space.prevent="select(item.key, item.value, source)"
```

样式规则：

```css
[data-interaction-state="primary"] {
  border-color: var(--screen-accent);
  box-shadow: 0 0 24px color-mix(in srgb, var(--screen-accent), transparent 62%);
  transform: translateY(-3px);
}

[data-interaction-state="related"] {
  border-color: color-mix(in srgb, var(--screen-accent), transparent 32%);
}

@media (prefers-reduced-motion: reduce) {
  [data-interaction-state] { transform: none; }
}
```

低性能档不应用 `box-shadow` 和 `transform`。状态矩阵保留格子本身的健康颜色，交互只增加描边，避免把健康含义覆盖掉。

- [ ] **Step 4: 运行 DOM 组件测试**

Run:

```bash
npm --prefix big-screen-center/frontend test -- --run \
  tests/interactive-widgets.test.ts \
  tests/status-matrix-labels.test.ts \
  tests/widget-host.test.ts
npm --prefix big-screen-center/frontend run typecheck
```

Expected: PASS。

- [ ] **Step 5: 提交 DOM 组件交互**

```bash
git add big-screen-center/frontend/src/components/widgets/MetricCards.vue \
  big-screen-center/frontend/src/components/widgets/RankingTable.vue \
  big-screen-center/frontend/src/components/widgets/StatusMatrix.vue \
  big-screen-center/frontend/tests/interactive-widgets.test.ts \
  big-screen-center/frontend/tests/status-matrix-labels.test.ts
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(big-screen): link metric widgets"
```

## Task 6: 接入 ECharts 原生事件和反向高亮

**Files:**
- Modify: `big-screen-center/frontend/src/components/widgets/EChartPanel.vue`
- Create: `big-screen-center/frontend/tests/echart-interaction.test.ts`

- [ ] **Step 1: 写 ECharts 事件映射失败测试**

mock `echarts/core` 的 `init`，保存 `on` 和 `dispatchAction` 调用，断言：

```ts
it('maps chart events to semantic targets and dispatches linked highlight', async () => {
  const { api } = mountWithInteraction(EChartPanel, {
    widget,
    data: { criticalRisks: 48, high: 12 },
    performanceProfile: 'high',
  })
  await flushPromises()

  emitChart('mouseover', { data: { metricKey: 'criticalRisks', value: 48 } })
  expect(api.active.value?.key).toBe('criticalRisks')

  api.lock({
    ...api.targetFor(widget, 'high', 12, 'echart'),
    relatedKeys: ['criticalRisks'],
  })
  await nextTick()
  expect(dispatchAction).toHaveBeenCalledWith(expect.objectContaining({
    type: 'highlight',
    dataIndex: 0,
  }))
})
```

另一个测试断言 `globalout` 调用 `leave()`，卸载后调用 `off()` 和 `dispose()`。

- [ ] **Step 2: 运行测试并确认事件未注册**

Run:

```bash
npm --prefix big-screen-center/frontend test -- --run tests/echart-interaction.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 增加数据项业务键、tooltip 和事件适配**

注册 `TooltipComponent`：

```ts
use([
  BarChart,
  LineChart,
  GridComponent,
  PolarComponent,
  TooltipComponent,
  CanvasRenderer,
])
```

所有系列数据改为：

```ts
data: entries.map(([key, value]) => ({
  value,
  name: metricLabel(key),
  metricKey: key,
}))
```

3D 数据保留坐标，同时加业务字段：

```ts
data: entries.map(([key, value], index) => ({
  value: [index, 0, value],
  metricKey: key,
  metricValue: value,
}))
```

绑定事件：

```ts
const onChartHover = (params: { data?: Record<string, unknown> }) => {
  const key = String(params.data?.metricKey || '')
  const raw = params.data?.metricValue ?? params.data?.value
  const value = Array.isArray(raw) ? Number(raw[raw.length - 1]) : Number(raw)
  if (!key || !Number.isFinite(value)) return
  interaction.hover(interaction.targetFor(props.widget, key, value, 'echart'))
}

const onChartClick = (params: { data?: Record<string, unknown> }) => {
  const key = String(params.data?.metricKey || '')
  const raw = params.data?.metricValue ?? params.data?.value
  const value = Array.isArray(raw) ? Number(raw[raw.length - 1]) : Number(raw)
  if (!key || !Number.isFinite(value)) return
  interaction.lock(interaction.targetFor(props.widget, key, value, 'echart'))
}
```

首次初始化注册 `mouseover`、`click`、`globalout`。监听交互快照，先 `downplay` 和 `hideTip`，再按 `entries` 中的键调用 `highlight`；主关联调用 `showTip`，次关联只高亮。卸载时 `off` 后 `dispose`。

- [ ] **Step 4: 运行 ECharts 测试**

Run:

```bash
npm --prefix big-screen-center/frontend test -- --run \
  tests/echart-interaction.test.ts \
  tests/interactive-widgets.test.ts
npm --prefix big-screen-center/frontend run typecheck
```

Expected: PASS。

- [ ] **Step 5: 提交 ECharts 适配**

```bash
git add big-screen-center/frontend/src/components/widgets/EChartPanel.vue \
  big-screen-center/frontend/tests/echart-interaction.test.ts
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(big-screen): link chart interactions"
```

## Task 7: 接入 G6 和 MapLibre

**Files:**
- Modify: `big-screen-center/frontend/src/components/widgets/GraphPanel.vue`
- Modify: `big-screen-center/frontend/src/components/widgets/MapPanel.vue`
- Create: `big-screen-center/frontend/tests/graph-map-interaction.test.ts`

- [ ] **Step 1: 写 G6 与地图降级交互失败测试**

mock G6 `Graph` 和 MapLibre `Map`，断言：

```ts
it('registers G6 node and canvas interaction handlers', async () => {
  mountWithInteraction(GraphPanel, props)
  await flushPromises()
  expect(graphOn).toHaveBeenCalledWith('node:pointerenter', expect.any(Function))
  expect(graphOn).toHaveBeenCalledWith('node:click', expect.any(Function))
  expect(graphOn).toHaveBeenCalledWith('canvas:click', expect.any(Function))
})

it('does not invent map points when no GeoJSON is present', async () => {
  const { wrapper } = mountWithInteraction(MapPanel, {
    ...props,
    data: { customer_count: 12, license_count: 30 },
  })
  await flushPromises()
  expect(addSource).not.toHaveBeenCalled()
  expect(wrapper.findAll('[data-map-metric]')).toHaveLength(2)
})

it('uses valid GeoJSON features as interactive map points', async () => {
  const point = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [116.4, 39.9] },
    properties: {
      metricKey: 'customer_count',
      label: '客户数量',
      value: 12,
    },
  }
  const { api } = mountWithInteraction(MapPanel, {
    ...props,
    data: {
      geojson: { type: 'FeatureCollection', features: [point] },
    },
  })
  await flushPromises()

  expect(addSource).toHaveBeenCalledWith(
    'business-points',
    expect.objectContaining({ data: expect.any(Object) }),
  )
  emitMapLayer('click', 'business-points-layer', { features: [point] })
  expect(api.snapshot.value.locked?.key).toBe('customer_count')
})
```

- [ ] **Step 2: 运行测试并确认事件不存在**

Run:

```bash
npm --prefix big-screen-center/frontend test -- --run tests/graph-map-interaction.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现 G6 状态和地图真实数据优先降级**

G6：

- 节点 `data` 增加 `metricKey` 和 `metricValue`。
- 注册 `node:pointerenter`、`node:pointerleave`、`node:click`、`canvas:click`。
- 使用 `graph.setElementState(id, ['selected'])` 和 `graph.setElementState(id, [])` 表示主关联；次关联使用 `['active']`。
- watcher 根据 `interaction.snapshot` 更新节点状态。
- `onUnmounted` 调用 `graph.off()`、`destroy()`。

MapLibre：

- 检查 `data.geojson` 是否为合法 `FeatureCollection`，且 feature properties 包含 `metricKey`、`label` 和数值。
- 只有合法 GeoJSON 才添加 `business-points` source 和 circle layer，并注册 `mouseenter`、`mouseleave`、`click`。
- 没有 GeoJSON 时，在地图下方覆盖一个聚合指标条，使用 `numericMetricEntries(data, 4)` 生成真实指标按钮，并接入统一 provider。
- 将 `interactive: false` 改为 `interactive: true`，但关闭旋转，保留平移和缩放：

```ts
dragRotate: false,
pitchWithRotate: false,
touchPitch: false,
```

- 点击无 feature 的地图区域调用 `interaction.clear()`，拖动和缩放不清除。

- [ ] **Step 4: 运行图谱和地图测试**

Run:

```bash
npm --prefix big-screen-center/frontend test -- --run \
  tests/graph-map-interaction.test.ts \
  tests/interactive-widgets.test.ts
npm --prefix big-screen-center/frontend run typecheck
```

Expected: PASS，缺少坐标时没有伪造地图点。

- [ ] **Step 5: 提交 G6 和 MapLibre 适配**

```bash
git add big-screen-center/frontend/src/components/widgets/GraphPanel.vue \
  big-screen-center/frontend/src/components/widgets/MapPanel.vue \
  big-screen-center/frontend/tests/graph-map-interaction.test.ts
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(big-screen): link graph and map interactions"
```

## Task 8: 扩展 Three.js 场景协议并加入 Raycaster

**Files:**
- Modify: `big-screen-center/frontend/src/registry/scenes.ts`
- Modify: `big-screen-center/frontend/src/components/widgets/ThreeScene.vue`
- Modify: `big-screen-center/frontend/src/scenes/createOrbitScene.ts`
- Create: `big-screen-center/frontend/tests/scene-interaction.test.ts`

- [ ] **Step 1: 写场景协议和事件清理失败测试**

```ts
it('forwards scene hover and selection into the screen interaction context', async () => {
  const { api } = mountWithInteraction(ThreeScene, props)
  await flushPromises()
  const handlers = setInteractionHandlers.mock.calls[0][0]

  handlers.onHover({ key: 'criticalRisks', value: 48 })
  expect(api.active.value?.key).toBe('criticalRisks')
  handlers.onSelect({ key: 'criticalRisks', value: 48 })
  expect(api.snapshot.value.locked?.key).toBe('criticalRisks')
})

it('disposes pointer handlers with the scene', () => {
  const scene = createOrbitScene(container, 'high', options)
  expect(canvas.addEventListener).toHaveBeenCalledWith(
    'pointermove',
    expect.any(Function),
  )
  scene.dispose()
  expect(canvas.removeEventListener).toHaveBeenCalledWith(
    'pointermove',
    expect.any(Function),
  )
})
```

- [ ] **Step 2: 运行测试并确认协议缺失**

Run:

```bash
npm --prefix big-screen-center/frontend test -- --run tests/scene-interaction.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 扩展 `ManagedScene` 并实现命中**

在 `registry/scenes.ts` 增加：

```ts
export interface SceneInteractionDatum {
  key: string
  value?: number
}

export interface SceneInteractionHandlers {
  onHover(target: SceneInteractionDatum | null): void
  onSelect(target: SceneInteractionDatum): void
}

export interface ManagedScene {
  start(): void
  pause(): void
  resize(width: number, height: number, pixelRatio: number): void
  update(data: unknown): void
  setInteraction?(snapshot: InteractionSnapshot): void
  setInteractionHandlers?(handlers: SceneInteractionHandlers): void
  dispose(): void
}
```

`ThreeScene.vue`：

- 场景创建后调用 `setInteractionHandlers`。
- `onHover` 为 `null` 时调用 `leave()`，否则用 `targetFor(..., 'three')` 丰富目标。
- `onSelect` 调用 `lock()`。
- watch `interaction.snapshot` 并调用 `managedScene.setInteraction()`。

`createOrbitScene.ts`：

- 保存 rings 和 core 到 `selectableObjects`。
- `update(data)` 使用 `numericMetricEntries(data, selectableObjects.length)`，把 `key` 和 `value` 写入 `object.userData`。
- 创建 `Raycaster` 和 `Vector2`，按 canvas bounds 计算 normalized device coordinates。
- `pointermove` 命中后调用 `onHover`；无命中调用 `onHover(null)`。
- `click` 命中后调用 `onSelect`。
- `setInteraction` 按主关联、次关联、无关设置材质 `opacity` 和 `color`，低性能档不改变缩放和相机。
- `dispose()` 移除 `pointermove`、`pointerleave` 和 `click`，再释放几何体、材质和 renderer。

- [ ] **Step 4: 运行场景测试和 WebGL 降级测试**

Run:

```bash
npm --prefix big-screen-center/frontend test -- --run tests/scene-interaction.test.ts
npm --prefix big-screen-center/frontend run typecheck
npm --prefix big-screen-center/frontend run test:e2e -- e2e/degradation.spec.ts
```

Expected: PASS，WebGL 不可用时仍回退到 ECharts 且指标卡可用。

- [ ] **Step 5: 提交 Three.js 交互**

```bash
git add big-screen-center/frontend/src/registry/scenes.ts \
  big-screen-center/frontend/src/components/widgets/ThreeScene.vue \
  big-screen-center/frontend/src/scenes/createOrbitScene.ts \
  big-screen-center/frontend/tests/scene-interaction.test.ts
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(big-screen): add raycast scene interactions"
```

## Task 9: 逐模板验收、最终验证、版本升级和推送

**Files:**
- Create: `big-screen-center/frontend/e2e/player-interactions.spec.ts`
- Modify: `big-screen-center/frontend/e2e/player-layouts.spec.ts`
- Modify: `big-screen-center/README.md`

- [ ] **Step 1: 写 12 模板端到端交互验收**

`player-interactions.spec.ts`：

```ts
import { expect, test } from '@playwright/test'

import { TEMPLATE_BLUEPRINTS } from '../src/templates/manifests'

for (const [id] of TEMPLATE_BLUEPRINTS) {
  test(`${id} supports linked hover, lock, switch, and clear`, async ({ page }) => {
    test.setTimeout(90_000)
    await page.addInitScript(() => {
      window.sessionStorage.setItem('big-screen-mock', '1')
      window.sessionStorage.setItem('big-screen-profile', 'medium')
    })
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto(`/play/${id}?mock=1`)

    const cards = page.locator('[data-widget="metric-cards"] [data-interaction-key]')
    await expect(cards).toHaveCount(4)

    const first = cards.nth(0)
    const second = cards.nth(1)
    await first.hover()
    await expect(first).toHaveAttribute('data-interaction-state', 'primary')

    await first.click()
    await expect(page.locator('[data-interaction-console]')).toBeVisible()
    await expect(first).toHaveAttribute('aria-pressed', 'true')

    await second.click()
    await expect(second).toHaveAttribute('aria-pressed', 'true')
    await expect(first).toHaveAttribute('aria-pressed', 'false')

    await page.keyboard.press('Escape')
    await expect(page.locator('[data-interaction-console]')).toHaveCount(0)
  })
}

test('low profile keeps color feedback without motion', async ({ page }) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem('big-screen-mock', '1')
    window.sessionStorage.setItem('big-screen-profile', 'low')
  })
  await page.goto('/play/sca-01?mock=1')
  const card = page.locator('[data-interaction-key]').first()
  await card.hover()
  await expect(card).toHaveAttribute('data-interaction-state', 'primary')
  await expect(card).toHaveCSS('transform', 'none')
})
```

在 `player-layouts.spec.ts` 每套模板初始渲染断言：

```ts
await expect(page.locator('[data-interaction-console]')).toHaveCount(0)
```

- [ ] **Step 2: 先运行 E2E 并修复真实集成问题**

Run:

```bash
npm --prefix big-screen-center/frontend run test:e2e -- \
  e2e/player-interactions.spec.ts \
  e2e/player-layouts.spec.ts \
  e2e/degradation.spec.ts
```

Expected: 12 套模板在标准屏通过悬停、锁定、切换和清除；降级场景继续通过。

- [ ] **Step 3: 更新 README 并执行完整快速验证**

在 `big-screen-center/README.md` 增加：

```md
## 模板交互

- 悬停指标可预览同模板关联数据，点击后锁定并打开底部分析台。
- 点击其他指标切换锁定，点击空白、关闭按钮或按 Esc 清除。
- “前往业务系统”只打开白名单内路径，并过滤敏感查询参数。
- `VITE_SCA_APP_URL`、`VITE_TRAIN_EXAM_APP_URL`、
  `VITE_REMINDER_APP_URL` 可覆盖三个业务系统前端地址。
```

Run:

```bash
npm --prefix big-screen-center/backend test -- --run tests/catalog.test.ts
npm --prefix big-screen-center/frontend test -- --run
npm --prefix big-screen-center/frontend run typecheck
npm --prefix big-screen-center/frontend run build
node big-screen-center/deploy/verify-offline-assets.mjs
docker compose config --quiet
```

Expected: 全部 PASS，构建产物不引用第三方在线资源。

- [ ] **Step 4: 检查提交范围和版本前置状态**

Run:

```bash
git status --short
git diff --check
git log --oneline --decorate -10
```

Expected:

- 只剩本任务 README/E2E 修改未提交，以及用户原有未跟踪文件。
- 中间提交均存在，当前版本仍为 `5.70.11`。
- 没有把 `.superpowers/`、`dist/`、`test-results/` 或压缩包加入索引。

- [ ] **Step 5: 正常提交触发功能版本升级和自动推送**

```bash
git add big-screen-center/frontend/e2e/player-interactions.spec.ts \
  big-screen-center/frontend/e2e/player-layouts.spec.ts \
  big-screen-center/README.md
git commit -m "feat(big-screen): add linked template interactions"
```

Expected:

- 版本钩子将 `5.70.11` 升为 `5.71.0`。
- 分支从 `codex/5.70.11` 移动到 `codex/5.71.0`。
- 自动推送 `origin/codex/5.71.0`。

- [ ] **Step 6: 核对远端并重建大屏容器**

Run:

```bash
git status --short --branch
git log -3 --oneline --decorate
git ls-remote --heads origin codex/5.71.0
docker compose up -d --build big-screen-api web-big-screen
docker compose ps big-screen-api web-big-screen
curl --fail --max-time 10 http://127.0.0.1:5192/api/big-screen/health
curl --fail --max-time 10 http://127.0.0.1:18092/
```

Expected:

- 本地 `HEAD`、`origin/codex/5.71.0` 和 `ls-remote` 哈希一致。
- 两个容器为 running/healthy。
- BFF 健康接口和前端首页返回成功。

## 最终验收清单

- [ ] 12 套模板都至少有 4 个可悬停、点击和键盘选择的核心指标。
- [ ] 悬停离开后恢复锁定状态；无锁定时恢复默认。
- [ ] 点击其他指标切换锁定，空白、关闭按钮和 Esc 都能清除。
- [ ] ECharts、G6、MapLibre、Three.js 使用各自原生事件适配。
- [ ] 没有业务坐标时地图不生成假点位。
- [ ] 自动刷新保留仍存在的指标，指标消失时关闭分析台。
- [ ] 底部分析台在 16:9、超宽和小预览尺寸可读。
- [ ] 所有可见标签、提示、排行和分析文案均为中文。
- [ ] 低性能和减少动态效果模式不执行位移、镜头聚焦和复杂阴影。
- [ ] 业务跳转只允许白名单路径，不携带令牌或敏感字段。
- [ ] 未登录仍跳转统一登录，不展示预览数据。
- [ ] 最终版本为 `5.71.0`，提交和远端分支一致。

## 官方实现参考

- Apache ECharts 事件与行为：<https://echarts.apache.org/handbook/zh/concepts/event/>
- AntV G6 事件 API：<https://g6.antv.antgroup.com/en/api/event>
- Three.js Raycaster：<https://threejs.org/docs/pages/Raycaster.html>
