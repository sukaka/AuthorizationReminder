# Unified Big Screen Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建设独立统一大屏中心，通过统一登录和受控 BFF 汇聚 SCA、培训考试、授权提醒三个系统的数据，交付 12 套具有双布局、动态效果、离线能力和故障降级的成品大屏。

**Architecture:** 新增 `big-screen-center/frontend` Vue 3 应用和 `big-screen-center/backend` Node.js TypeScript BFF；BFF 只调用业务 API，并把模板、草稿、发布版本、播放列表和审计记录保存到独立 MySQL 数据库 `juxin_big_screen`。前端使用声明式模板清单和白名单组件注册表装配 Three.js、ECharts、G6、MapLibre、GridStack、tsParticles、Anime.js 与 DataV Vue3，任何数据库配置都不能保存脚本、HTML、SQL 或任意 URL。

**Tech Stack:** Vue 3.5.35, TypeScript 6.0.3, Vite 8.0.16, Pinia 3.0.4, Vue Router 5.1.0, Three.js 0.184.0, Apache ECharts 6.1.0, ECharts GL 2.1.0, AntV G6 5.1.1, MapLibre GL JS 5.24.0, GridStack 12.6.0, tsParticles 4.1.3, Anime.js 4.4.1, DataV Vue3 1.7.4, Express 5.2.1, MySQL2 3.22.5, Zod 4.4.3, Vitest 4.1.8, Playwright 1.60.0

---

## 1. 实施边界

- 设计依据：`docs/superpowers/specs/2026-06-10-unified-big-screen-center-design.md`
- 新服务端口：前端 `18092`，BFF `5192`；`18090/18091` 已由 Dependency-Track 使用。
- 数据源：只允许 `sca-api:5191`、`train-exam-api:5188`、`api:5179` 和 `auth:5180`。
- 首期模板：SCA 5 套、培训考试 4 套、提醒 3 套。
- 每套模板提供 `1920x1080` 的 `widescreen` 和 `3840x1080` 的 `ultrawide` 布局。
- 每套模板最多一个常驻 Three.js 场景；所有 Three.js 模板必须有 `canvas2d` 或 `static` 降级。
- 实施期间的中间提交使用 `CODEX_VERSIONING_BYPASS=1`，最终功能提交使用正常 `feat(big-screen): ...`，只触发一次次版本升级、分支切换和推送。

## 2. 文件结构

```text
big-screen-center/
├── README.md
├── THIRD_PARTY_NOTICES.md
├── assets/
│   ├── fonts/.gitkeep
│   ├── geojson/china-provinces.json
│   ├── maps/style-offline.json
│   ├── models/.gitkeep
│   └── textures/.gitkeep
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── package-lock.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── src/
│   │   ├── app.ts
│   │   ├── server.ts
│   │   ├── config.ts
│   │   ├── auth.ts
│   │   ├── db.ts
│   │   ├── migrations.ts
│   │   ├── contracts.ts
│   │   ├── cache.ts
│   │   ├── circuit-breaker.ts
│   │   ├── audit.ts
│   │   ├── catalog.ts
│   │   ├── template-store.ts
│   │   ├── playlist-store.ts
│   │   ├── play-token-store.ts
│   │   ├── resource-pack-store.ts
│   │   ├── stream-hub.ts
│   │   ├── adapters/
│   │   │   ├── types.ts
│   │   │   ├── http-client.ts
│   │   │   ├── sca.ts
│   │   │   ├── train-exam.ts
│   │   │   └── reminder.ts
│   │   └── routes/
│   │       ├── catalog.ts
│   │       ├── data.ts
│   │       ├── templates.ts
│   │       ├── playlists.ts
│   │       └── health.ts
│   └── tests/
│       ├── auth.test.ts
│       ├── catalog.test.ts
│       ├── contracts.test.ts
│       ├── data-route.test.ts
│       ├── adapters.test.ts
│       ├── template-store.test.ts
│       ├── playlist-store.test.ts
│       └── stream-hub.test.ts
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── package.json
│   ├── package-lock.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── playwright.config.ts
│   ├── src/
│   │   ├── main.ts
│   │   ├── App.vue
│   │   ├── router.ts
│   │   ├── api.ts
│   │   ├── types.ts
│   │   ├── styles/base.css
│   │   ├── stores/session.ts
│   │   ├── composables/useDataChannel.ts
│   │   ├── composables/usePerformanceProfile.ts
│   │   ├── composables/useScreenScale.ts
│   │   ├── components/TemplateCatalog.vue
│   │   ├── components/ScreenPlayer.vue
│   │   ├── components/ScreenEditor.vue
│   │   ├── components/PlaylistPanel.vue
│   │   ├── components/SourceHealthBar.vue
│   │   ├── components/widgets/WidgetHost.vue
│   │   ├── components/widgets/MetricCards.vue
│   │   ├── components/widgets/EChartPanel.vue
│   │   ├── components/widgets/ThreeScene.vue
│   │   ├── components/widgets/GraphPanel.vue
│   │   ├── components/widgets/MapPanel.vue
│   │   ├── components/widgets/StatusMatrix.vue
│   │   ├── components/widgets/RankingTable.vue
│   │   ├── components/widgets/TechFrame.vue
│   │   ├── registry/widgets.ts
│   │   ├── registry/scenes.ts
│   │   ├── scenes/createRiskGlobe.ts
│   │   ├── scenes/createCourseGalaxy.ts
│   │   ├── scenes/createExpiryOrbit.ts
│   │   ├── templates/manifests.ts
│   │   ├── views/CatalogView.vue
│   │   ├── views/PlayerView.vue
│   │   └── views/EditorView.vue
│   ├── tests/
│   │   ├── manifests.test.ts
│   │   ├── screen-scale.test.ts
│   │   ├── performance-profile.test.ts
│   │   ├── widget-host.test.ts
│   │   ├── editor-constraints.test.ts
│   │   └── playlist-panel.test.ts
│   └── e2e/
│       ├── catalog.spec.ts
│       ├── player-layouts.spec.ts
│       ├── degradation.spec.ts
│       └── editor-playlist.spec.ts
└── deploy/
    ├── env.example
    └── verify-offline-assets.mjs
```

`auth/index.js`、`auth/portal-routing.js`、`auth/system-access-display.js`、`docker-compose.yml` 和对应测试只做增量修改，不拆分现有大文件。

### Task 1: 固定依赖、许可证和项目骨架

**Files:**
- Create: `big-screen-center/backend/package.json`
- Create: `big-screen-center/backend/tsconfig.json`
- Create: `big-screen-center/backend/vitest.config.ts`
- Create: `big-screen-center/frontend/package.json`
- Create: `big-screen-center/frontend/tsconfig.json`
- Create: `big-screen-center/frontend/vite.config.ts`
- Create: `big-screen-center/THIRD_PARTY_NOTICES.md`
- Create: `big-screen-center/deploy/verify-offline-assets.mjs`
- Test: `big-screen-center/backend/tests/contracts.test.ts`

- [ ] **Step 1: 先写依赖和许可证守卫测试**

```ts
import { describe, expect, it } from 'vitest'
import backendPackage from '../package.json'
import frontendPackage from '../../frontend/package.json'

describe('dependency policy', () => {
  it('pins runtime dependencies without ranges', () => {
    const values = [
      ...Object.values(backendPackage.dependencies),
      ...Object.values(frontendPackage.dependencies),
    ]
    expect(values.every((value) => /^\d+\.\d+\.\d+$/.test(value))).toBe(true)
  })

  it('uses only approved browser data-visualization packages', () => {
    expect(Object.keys(frontendPackage.dependencies).sort()).toEqual(expect.arrayContaining([
      '@antv/g6',
      '@kjgl77/datav-vue3',
      '@tsparticles/vue3',
      'animejs',
      'echarts',
      'echarts-gl',
      'gridstack',
      'maplibre-gl',
      'three',
      'tsparticles',
    ]))
  })
})
```

- [ ] **Step 2: 运行测试并确认因项目文件不存在而失败**

Run: `npm --prefix big-screen-center/backend test -- --run tests/contracts.test.ts`

Expected: FAIL，提示 `package.json`、Vitest 配置或测试脚本不存在。

- [ ] **Step 3: 创建后端和前端 package.json**

后端运行依赖固定为：

```json
{
  "name": "juxin-big-screen-backend",
  "version": "5.69.2",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "test": "vitest",
    "test:run": "vitest run"
  },
  "dependencies": {
    "cookie-parser": "1.4.7",
    "cors": "2.8.6",
    "express": "5.2.1",
    "mysql2": "3.22.5",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@types/cookie-parser": "1.4.10",
    "@types/cors": "2.8.19",
    "@types/express": "5.0.6",
    "@types/node": "20.19.42",
    "@types/supertest": "6.0.3",
    "supertest": "7.2.2",
    "tsx": "4.22.4",
    "typescript": "6.0.3",
    "vitest": "4.1.8"
  }
}
```

前端运行依赖固定为：

```json
{
  "name": "juxin-big-screen-frontend",
  "version": "5.69.2",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "vue-tsc -b && vite build",
    "test": "vitest",
    "test:run": "vitest run",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@antv/g6": "5.1.1",
    "@kjgl77/datav-vue3": "1.7.4",
    "@tsparticles/vue3": "4.1.3",
    "animejs": "4.4.1",
    "echarts": "6.1.0",
    "echarts-gl": "2.1.0",
    "gridstack": "12.6.0",
    "maplibre-gl": "5.24.0",
    "pinia": "3.0.4",
    "three": "0.184.0",
    "tsparticles": "4.1.3",
    "vue": "3.5.35",
    "vue-router": "5.1.0"
  },
  "devDependencies": {
    "@playwright/test": "1.60.0",
    "@types/node": "20.19.42",
    "@types/three": "0.184.1",
    "@vitejs/plugin-vue": "6.0.7",
    "@vue/test-utils": "2.4.11",
    "jsdom": "29.1.1",
    "typescript": "6.0.3",
    "vite": "8.0.16",
    "vitest": "4.1.8",
    "vue-tsc": "3.3.4"
  }
}
```

后端 `tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": ".",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts"]
}
```

前端 `tsconfig.json` 和 `vite.config.ts`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "jsx": "preserve",
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "types": ["vite/client", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "src/**/*.vue", "tests/**/*.ts", "vite.config.ts"]
}
```

```ts
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: { '/api/big-screen': 'http://localhost:5192' },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
})
```

`THIRD_PARTY_NOTICES.md` 必须逐项记录包名、精确版本、许可证、官方仓库和用途。`@kjgl77/datav-vue3` 只允许被 `TechFrame.vue` 引用，便于维护状态变化时单点替换。

- [ ] **Step 4: 安装锁文件并运行依赖测试**

Run:

```bash
npm --prefix big-screen-center/backend install
npm --prefix big-screen-center/frontend install
npm --prefix big-screen-center/backend test -- --run tests/contracts.test.ts
```

Expected: 依赖安装成功，`contracts.test.ts` PASS。

- [ ] **Step 5: 提交骨架**

```bash
git add big-screen-center
CODEX_VERSIONING_BYPASS=1 git commit -m "build(big-screen): scaffold pinned visual stack"
```

### Task 2: 定义安全模板契约和 12 套清单

**Files:**
- Create: `big-screen-center/backend/src/contracts.ts`
- Create: `big-screen-center/backend/src/catalog.ts`
- Create: `big-screen-center/frontend/src/types.ts`
- Create: `big-screen-center/frontend/src/templates/manifests.ts`
- Test: `big-screen-center/backend/tests/catalog.test.ts`
- Test: `big-screen-center/frontend/tests/manifests.test.ts`

- [ ] **Step 1: 写契约拒绝脚本、SQL、HTML 和外部 URL 的失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { ScreenTemplateSchema } from '../src/contracts'

const baseTemplate = {
  id: 'sca-01',
  systemKey: 'sca',
  name: '全域安全态势',
  version: 1,
  themeKey: 'security-orbit',
  effectsProfile: 'high',
  layouts: {
    widescreen: { width: 1920, height: 1080, areas: ['hero', 'left', 'right', 'footer'] },
    ultrawide: { width: 3840, height: 1080, areas: ['left', 'hero', 'right', 'far-right'] },
  },
  widgets: [],
  filters: [],
  refreshPolicy: { mode: 'poll', intervalMs: 30000 },
}

describe('ScreenTemplateSchema', () => {
  it.each([
    ['script', { script: 'alert(1)' }],
    ['html', { html: '<iframe src=x>' }],
    ['sql', { sql: 'select * from users' }],
    ['url', { url: 'https://unapproved.example/a.json' }],
  ])('rejects %s in widget config', (_name, config) => {
    expect(() => ScreenTemplateSchema.parse({
      ...baseTemplate,
      widgets: [{
        id: 'unsafe',
        type: 'metric-cards',
        dataSourceKey: 'security-overview',
        layoutArea: 'left',
        optional: true,
        minWidth: 2,
        minHeight: 2,
        maxWidth: 6,
        maxHeight: 6,
        config,
      }],
    })).toThrow()
  })
})
```

- [ ] **Step 2: 运行契约测试确认失败**

Run: `npm --prefix big-screen-center/backend test -- --run tests/catalog.test.ts`

Expected: FAIL with `Cannot find module '../src/contracts'`。

- [ ] **Step 3: 实现共享契约**

```ts
import { z } from 'zod'

export const SystemKeySchema = z.enum(['sca', 'train-exam', 'reminder'])
export const EffectsProfileSchema = z.enum(['high', 'medium', 'low'])
export const DataStatusSchema = z.enum(['ok', 'partial', 'stale', 'empty', 'error'])
export const RegisteredWidgetTypeSchema = z.enum([
  'metric-cards',
  'echart',
  'three-scene',
  'graph',
  'map',
  'status-matrix',
  'ranking-table',
])

const JsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
export const SafeJsonSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([JsonPrimitiveSchema, z.array(SafeJsonSchema), z.record(z.string(), SafeJsonSchema)])
).superRefine((value, ctx) => {
  if (!value || Array.isArray(value) || typeof value !== 'object') return
  const forbidden = /^(script|html|sql|url|src|href|endpoint)$/i
  for (const key of Object.keys(value)) {
    if (forbidden.test(key)) {
      ctx.addIssue({ code: 'custom', message: `Forbidden config key: ${key}` })
    }
  }
})

export const LayoutSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  areas: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)).min(1),
})

export const WidgetSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  type: RegisteredWidgetTypeSchema,
  dataSourceKey: z.string().regex(/^[a-z0-9-]+$/),
  layoutArea: z.string().regex(/^[a-z][a-z0-9-]*$/),
  optional: z.boolean(),
  minWidth: z.number().int().positive(),
  minHeight: z.number().int().positive(),
  maxWidth: z.number().int().positive(),
  maxHeight: z.number().int().positive(),
  config: SafeJsonSchema,
}).refine((value) => value.minWidth <= value.maxWidth && value.minHeight <= value.maxHeight, {
  message: 'Widget min size must not exceed max size',
})

export const ScreenTemplateSchema = z.object({
  id: z.string().regex(/^(sca|train|remind)-0[1-9]$/),
  systemKey: SystemKeySchema,
  name: z.string().min(2).max(40),
  version: z.number().int().positive(),
  themeKey: z.string().regex(/^[a-z0-9-]+$/),
  effectsProfile: EffectsProfileSchema,
  layouts: z.object({ widescreen: LayoutSchema, ultrawide: LayoutSchema }),
  widgets: z.array(WidgetSchema).min(4),
  filters: z.array(z.object({
    key: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
    type: z.enum(['date-range', 'select', 'multi-select']),
    required: z.boolean(),
  })),
  refreshPolicy: z.object({
    mode: z.enum(['poll', 'sse', 'manual']),
    intervalMs: z.number().int().min(5000).max(600000),
  }),
})

export type ScreenTemplate = z.infer<typeof ScreenTemplateSchema>

export interface MetricEnvelope<T = unknown> {
  schemaVersion: '1.0'
  systemKey: z.infer<typeof SystemKeySchema>
  metricKey: string
  generatedAt: string
  sourceUpdatedAt: string | null
  stale: boolean
  status: z.infer<typeof DataStatusSchema>
  data: T
  unavailableSources: string[]
}
```

- [ ] **Step 4: 建立 12 套模板清单**

`manifests.ts` 使用一个显式数组，模板 ID、核心数据键和核心视觉固定如下：

```ts
export const TEMPLATE_BLUEPRINTS = [
  ['sca-01', 'sca', '全域安全态势', 'security-overview', 'risk-globe', 'sse'],
  ['sca-02', 'sca', '漏洞与威胁态势', 'vulnerability-threat', 'threat-radar', 'poll'],
  ['sca-03', 'sca', '供应链资产图谱', 'supply-chain-graph', 'dependency-space', 'poll'],
  ['sca-04', 'sca', '扫描运营中心', 'scan-operations', 'scan-pipeline', 'sse'],
  ['sca-05', 'sca', '安全治理成果', 'security-governance', 'security-route', 'poll'],
  ['train-01', 'train-exam', '培训运营总览', 'training-overview', 'course-galaxy', 'poll'],
  ['train-02', 'train-exam', '考试实时指挥', 'exam-command', 'exam-matrix', 'sse'],
  ['train-03', 'train-exam', '组织能力画像', 'organization-capability', 'capability-terrain', 'poll'],
  ['train-04', 'train-exam', '培训成果汇报', 'training-outcomes', 'growth-stairway', 'poll'],
  ['remind-01', 'reminder', '授权到期风险态势', 'expiry-risk', 'expiry-orbit', 'poll'],
  ['remind-02', 'reminder', '提醒执行与触达', 'delivery-execution', 'message-network', 'sse'],
  ['remind-03', 'reminder', '客户与销售经营', 'customer-sales', 'customer-map', 'poll'],
] as const
```

清单生成器必须为每套模板加入 `metric-cards`、核心视觉、趋势图、排行表和健康状态五类组件，并为两种布局分别声明区域。测试断言 `12` 套、系统分布 `5/4/3`、布局尺寸正确、Three.js 场景每套不超过一个。

- [ ] **Step 5: 运行契约和前端清单测试**

Run:

```bash
npm --prefix big-screen-center/backend test -- --run tests/catalog.test.ts
npm --prefix big-screen-center/frontend test -- --run tests/manifests.test.ts
```

Expected: 两组测试 PASS。

- [ ] **Step 6: 提交模板契约**

```bash
git add big-screen-center/backend/src big-screen-center/backend/tests big-screen-center/frontend/src/types.ts big-screen-center/frontend/src/templates big-screen-center/frontend/tests
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(big-screen): define safe template catalog"
```

### Task 3: 接入统一登录、系统入口和 Docker Compose

**Files:**
- Modify: `auth/portal-routing.js`
- Modify: `auth/system-access-display.js`
- Modify: `auth/index.js`
- Create: `auth/big-screen-authorization.js`
- Modify: `auth/tests/portal-routing.test.js`
- Modify: `auth/tests/system-access-display.test.js`
- Create: `auth/tests/big-screen-authorization.test.js`
- Create: `auth/tests/big-screen-portal-source.test.js`
- Modify: `docker-compose.yml`
- Create: `big-screen-center/backend/Dockerfile`
- Create: `big-screen-center/frontend/Dockerfile`
- Create: `big-screen-center/frontend/nginx.conf`

- [ ] **Step 1: 写统一入口失败测试**

```js
test('business users receive big-screen portal access', () => {
  assert.ok(defaultAppAccessByRole('admin').includes('big-screen'))
  assert.ok(defaultAppAccessByRole('editor').includes('big-screen'))
  assert.ok(defaultAppAccessByRole('reviewer').includes('big-screen'))
  assert.ok(defaultAppAccessByRole('user').includes('big-screen'))
})

test('big-screen has a stable Chinese display label', () => {
  assert.equal(getSystemDisplayLabel('big-screen'), '统一大屏展示中心')
})

test('big-screen authorization follows role capabilities', () => {
  assert.equal(authorizeBigScreen({ role: 'user', app_access: '["big-screen"]' }, 'screen:play').allow, true)
  assert.equal(authorizeBigScreen({ role: 'reviewer', app_access: '["big-screen"]' }, 'playlist:write').allow, true)
  assert.equal(authorizeBigScreen({ role: 'editor', app_access: '["big-screen"]' }, 'template:publish').allow, true)
  assert.equal(authorizeBigScreen({ role: 'user', app_access: '["big-screen"]' }, 'template:publish').allow, false)
})
```

该角色测试放入 `auth/tests/big-screen-authorization.test.js`，从 `auth/big-screen-authorization.js` 导入 `authorizeBigScreen`。`big-screen-portal-source.test.js` 读取 `auth/index.js`，断言存在：

```js
assert.match(source, /APP_BIG_SCREEN_URL/)
assert.match(source, /key:\s*'big-screen'/)
assert.match(source, /name:\s*'统一大屏展示中心'/)
```

- [ ] **Step 2: 运行认证测试确认失败**

Run: `node --test auth/tests/portal-routing.test.js auth/tests/system-access-display.test.js auth/tests/big-screen-authorization.test.js auth/tests/big-screen-portal-source.test.js`

Expected: FAIL，缺少 `big-screen` 权限键、显示项和入口 URL。

- [ ] **Step 3: 增量注册系统**

在 `SYSTEM_ACCESS_KEYS` 和 `REQUIRED_BUSINESS_PORTAL_KEYS` 中加入 `big-screen`；所有普通业务角色默认拥有入口，但大屏 BFF 仍按用户实际拥有的 `sca`、`train-exam`、`reminder` 权限过滤目录和数据。

在 `auth/big-screen-authorization.js` 实现并由 `auth/index.js` 接入 `/api/auth/authorize` 分支：

```js
const { resolveUserAppAccess } = require('./portal-routing');

const allow = () => ({ allow: true });
const deny = (reason) => ({ allow: false, reason });

const authorizeBigScreen = (user, action) => {
  if (!user) return deny('未登录');
  if (!resolveUserAppAccess(user).includes('big-screen')) return deny('无权限访问统一大屏展示中心');
  const role = String(user.role || '').toLowerCase();
  if (action === 'app:enter' || action === 'catalog:read' || action === 'screen:play') return allow();
  if (action === 'playlist:write' && ['admin', 'editor', 'reviewer'].includes(role)) return allow();
  if ((action === 'template:draft' || action === 'template:publish') && ['admin', 'editor'].includes(role)) return allow();
  if (action === 'source:admin' && role === 'admin') return allow();
  return deny('当前角色无权执行该大屏操作');
};

module.exports = { authorizeBigScreen };
```

```js
} else if (system === 'big-screen') {
  result = authorizeBigScreen(user, action);
}
```

`auth/index.js` 增加：

```js
const bigScreenURL = process.env.APP_BIG_SCREEN_URL || 'http://localhost:18092';

if (appAccess.includes('big-screen')) {
  apps.push({
    key: 'big-screen',
    name: '统一大屏展示中心',
    url: bigScreenURL,
    allow: true,
  });
}
```

- [ ] **Step 4: 添加 Compose 服务**

后端环境变量固定为：

```yaml
PORT: 5192
AUTH_SERVICE_URL: http://auth:5180
AUTH_SYSTEM_KEY: big-screen
AUTH_COOKIE_NAME: juxin_auth_token
MYSQL_HOST: mysql
MYSQL_PORT: 3306
MYSQL_DATABASE: juxin_big_screen
MYSQL_USER: big_screen_user
MYSQL_PASSWORD: ${BIG_SCREEN_MYSQL_PASSWORD}
MYSQL_ADMIN_USER: root
MYSQL_ADMIN_PASSWORD: ${MYSQL_ROOT_PASSWORD}
SCA_API_URL: http://sca-api:5191
TRAIN_EXAM_API_URL: http://train-exam-api:5188
REMINDER_API_URL: http://api:5179
CORS_ORIGINS: http://localhost:18092,http://127.0.0.1:18092,http://${PUBLIC_HOST:-localhost}:18092
```

同时：

- `auth.CORS_ORIGINS` 加入 `18092` 三种来源。
- `auth` 增加 `APP_BIG_SCREEN_URL: "http://localhost:18092"`。
- `big-screen-api` 暴露 `5192:5192`。
- `web-big-screen` 暴露 `18092:80`。
- `web-big-screen` 的 Nginx 将 `/api/big-screen/` 代理到 `big-screen-api:5192`。
- `big-screen-api` 启动时使用管理员账号幂等创建 `juxin_big_screen`、`big_screen_user` 并收回其他库权限。

- [ ] **Step 5: 验证认证和 Compose**

Run:

```bash
node --test auth/tests/portal-routing.test.js auth/tests/system-access-display.test.js auth/tests/big-screen-authorization.test.js auth/tests/big-screen-portal-source.test.js
docker compose config --quiet
```

Expected: 测试 PASS，Compose 配置退出码 `0`，无端口冲突。

- [ ] **Step 6: 提交登录和部署入口**

```bash
git add auth docker-compose.yml big-screen-center/backend/Dockerfile big-screen-center/frontend/Dockerfile big-screen-center/frontend/nginx.conf
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(big-screen): register portal and compose services"
```

### Task 4: 实现 BFF 身份校验、独立数据库和发布模型

**Files:**
- Create: `big-screen-center/backend/src/config.ts`
- Create: `big-screen-center/backend/src/auth.ts`
- Create: `big-screen-center/backend/src/db.ts`
- Create: `big-screen-center/backend/src/migrations.ts`
- Create: `big-screen-center/backend/src/template-store.ts`
- Create: `big-screen-center/backend/src/playlist-store.ts`
- Create: `big-screen-center/backend/src/play-token-store.ts`
- Create: `big-screen-center/backend/src/audit.ts`
- Test: `big-screen-center/backend/tests/auth.test.ts`
- Test: `big-screen-center/backend/tests/template-store.test.ts`
- Test: `big-screen-center/backend/tests/playlist-store.test.ts`

- [ ] **Step 1: 写权限和不可变发布版本测试**

```ts
it('filters source systems by unified app access', async () => {
  const result = await authorizeRequest(fakeRequest, fakeFetchReturning({
    user: { id: 7, username: 'viewer', role: 'user' },
    apps: ['big-screen', 'reminder'],
  }))
  expect(result.allowedSystems).toEqual(['reminder'])
})

it('publishes immutable versions', async () => {
  const first = await store.publish('sca-01', 9)
  const second = await store.publish('sca-01', 9)
  expect(first.version).toBe(1)
  expect(second.version).toBe(2)
  expect(first.id).not.toBe(second.id)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix big-screen-center/backend test -- --run tests/auth.test.ts tests/template-store.test.ts tests/playlist-store.test.ts`

Expected: FAIL，身份模块、数据库表和存储类尚不存在。

- [ ] **Step 3: 建立数据库表**

`migrations.ts` 幂等创建：

```sql
CREATE TABLE IF NOT EXISTS screen_drafts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  template_id VARCHAR(32) NOT NULL,
  owner_user_id BIGINT NOT NULL,
  config_json JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_screen_draft_owner (template_id, owner_user_id)
);

CREATE TABLE IF NOT EXISTS screen_versions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  template_id VARCHAR(32) NOT NULL,
  version_no INT NOT NULL,
  config_json JSON NOT NULL,
  published_by BIGINT NOT NULL,
  published_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_screen_version (template_id, version_no)
);

CREATE TABLE IF NOT EXISTS screen_playlists (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(80) NOT NULL,
  owner_user_id BIGINT NOT NULL,
  items_json JSON NOT NULL,
  schedule_json JSON NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

CREATE TABLE IF NOT EXISTS screen_audit_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  actor_user_id BIGINT NOT NULL,
  action VARCHAR(64) NOT NULL,
  entity_type VARCHAR(32) NOT NULL,
  entity_id VARCHAR(64) NOT NULL,
  detail_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_screen_audit_created (created_at)
);

CREATE TABLE IF NOT EXISTS metric_snapshots (
  cache_key VARCHAR(160) PRIMARY KEY,
  envelope_json JSON NOT NULL,
  source_updated_at DATETIME(3) NULL,
  expires_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

CREATE TABLE IF NOT EXISTS screen_play_tokens (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  token_hash CHAR(64) NOT NULL,
  owner_user_id BIGINT NOT NULL,
  allowed_systems_json JSON NOT NULL,
  playlist_id BIGINT NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_screen_play_token_hash (token_hash),
  KEY idx_screen_play_token_expiry (expires_at)
);

CREATE TABLE IF NOT EXISTS screen_resource_packs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  pack_key VARCHAR(64) NOT NULL,
  version_no INT NOT NULL,
  manifest_json JSON NOT NULL,
  sha256 CHAR(64) NOT NULL,
  signature_base64 TEXT NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  uploaded_by BIGINT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_screen_resource_pack_version (pack_key, version_no)
);
```

- [ ] **Step 4: 实现角色能力**

```ts
export type ScreenRole = 'viewer' | 'operator' | 'designer' | 'sysadmin'

export const roleCapabilities: Record<ScreenRole, ReadonlySet<string>> = {
  viewer: new Set(['catalog:read', 'screen:play']),
  operator: new Set(['catalog:read', 'screen:play', 'playlist:write']),
  designer: new Set(['catalog:read', 'screen:play', 'playlist:write', 'template:draft', 'template:publish']),
  sysadmin: new Set(['catalog:read', 'screen:play', 'playlist:write', 'template:draft', 'template:publish', 'source:admin']),
}
```

统一登录返回的 `admin` 映射为 `sysadmin`，`editor` 映射为 `designer`，`reviewer` 映射为 `operator`，其余映射为 `viewer`。身份检查必须同时满足用户拥有 `big-screen` 和目标业务系统入口。

全屏播放端通过 `POST /api/big-screen/play-tokens` 获取 30 分钟有效的随机令牌。数据库只保存 `SHA-256` 哈希；令牌只包含允许的业务系统和可选播放列表 ID，不能携带或兑换业务系统密钥。退出全屏、权限变化或管理员撤销时立即失效。

- [ ] **Step 5: 运行数据库与权限测试**

Run: `npm --prefix big-screen-center/backend test -- --run tests/auth.test.ts tests/template-store.test.ts tests/playlist-store.test.ts`

Expected: PASS；发布两次生成两个不可变版本，播放列表只能引用已发布版本。

- [ ] **Step 6: 提交数据模型**

```bash
git add big-screen-center/backend/src big-screen-center/backend/tests
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(big-screen): add auth and immutable publishing"
```

### Task 5: 实现三类业务 Adapter、缓存、熔断与 SSE

**Files:**
- Create: `big-screen-center/backend/src/cache.ts`
- Create: `big-screen-center/backend/src/circuit-breaker.ts`
- Create: `big-screen-center/backend/src/stream-hub.ts`
- Create: `big-screen-center/backend/src/adapters/types.ts`
- Create: `big-screen-center/backend/src/adapters/http-client.ts`
- Create: `big-screen-center/backend/src/adapters/sca.ts`
- Create: `big-screen-center/backend/src/adapters/train-exam.ts`
- Create: `big-screen-center/backend/src/adapters/reminder.ts`
- Create: `big-screen-center/backend/src/routes/data.ts`
- Test: `big-screen-center/backend/tests/adapters.test.ts`
- Test: `big-screen-center/backend/tests/data-route.test.ts`
- Test: `big-screen-center/backend/tests/stream-hub.test.ts`

- [ ] **Step 1: 写标准状态和缓存降级失败测试**

```ts
it('returns stale snapshot when the source times out', async () => {
  cache.seed('sca:security-overview:{}', okEnvelope)
  source.failWith(new Error('timeout'))
  const response = await request(app)
    .get('/api/big-screen/data/sca/security-overview')
    .set('Cookie', 'juxin_auth_token=test')
  expect(response.status).toBe(200)
  expect(response.body.status).toBe('stale')
  expect(response.body.stale).toBe(true)
  expect(response.body.data).toEqual(okEnvelope.data)
})

it('coalesces concurrent identical requests', async () => {
  await Promise.all(Array.from({ length: 20 }, () => service.getMetric('sca', 'security-overview', {})))
  expect(source.calls).toBe(1)
})
```

- [ ] **Step 2: 运行 Adapter 测试确认失败**

Run: `npm --prefix big-screen-center/backend test -- --run tests/adapters.test.ts tests/data-route.test.ts tests/stream-hub.test.ts`

Expected: FAIL，缺少 Adapter、缓存和流模块。

- [ ] **Step 3: 实现数据源映射**

SCA Adapter 只调用：

```text
/api/sca/overview
/api/sca/assets/dashboard
/api/sca/dependency-check/status
/api/sca/devops/dashboard
```

培训考试 Adapter 只调用：

```text
/api/train-exam/stats/overview
/api/train-exam/stats/pass-trend?days=30
/api/train-exam/stats/org-breakdown
```

提醒 Adapter 只调用：

```text
/api/dashboard
/api/sales-license-overview
```

`http-client.ts` 转发当前请求的 `Cookie`、`X-Request-Id`，超时默认 `4000ms`，不记录 cookie 内容。Adapter 输出统一 `MetricEnvelope`，联系人、手机号、邮箱只保留脱敏结果。

- [ ] **Step 4: 实现缓存和熔断参数**

```ts
export const metricPolicies = {
  'security-overview': { ttlMs: 30_000, staleMs: 600_000, streamMs: 10_000 },
  'vulnerability-threat': { ttlMs: 60_000, staleMs: 900_000, streamMs: 0 },
  'supply-chain-graph': { ttlMs: 300_000, staleMs: 1_800_000, streamMs: 0 },
  'scan-operations': { ttlMs: 15_000, staleMs: 300_000, streamMs: 10_000 },
  'security-governance': { ttlMs: 300_000, staleMs: 3_600_000, streamMs: 0 },
  'training-overview': { ttlMs: 60_000, staleMs: 900_000, streamMs: 0 },
  'exam-command': { ttlMs: 10_000, staleMs: 120_000, streamMs: 5_000 },
  'organization-capability': { ttlMs: 300_000, staleMs: 1_800_000, streamMs: 0 },
  'training-outcomes': { ttlMs: 300_000, staleMs: 3_600_000, streamMs: 0 },
  'expiry-risk': { ttlMs: 60_000, staleMs: 900_000, streamMs: 0 },
  'delivery-execution': { ttlMs: 15_000, staleMs: 300_000, streamMs: 10_000 },
  'customer-sales': { ttlMs: 300_000, staleMs: 1_800_000, streamMs: 0 },
} as const
```

连续 `5` 次失败打开熔断器 `30s`；半开只允许一个探测请求。缓存顺序为内存新鲜值、合并中的 Promise、业务 API、MySQL 最后成功快照、`error`。

- [ ] **Step 5: 验证 Adapter、缓存和 SSE**

Run: `npm --prefix big-screen-center/backend test -- --run tests/adapters.test.ts tests/data-route.test.ts tests/stream-hub.test.ts`

Expected: PASS；并发请求只触发一次上游调用，SSE 断开后定时器被释放。

- [ ] **Step 6: 提交 BFF 数据层**

```bash
git add big-screen-center/backend/src big-screen-center/backend/tests
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(big-screen): add adapters cache and streams"
```

### Task 6: 建立前端目录、缩放、组件注册和性能分级

**Files:**
- Create: `big-screen-center/frontend/src/main.ts`
- Create: `big-screen-center/frontend/src/App.vue`
- Create: `big-screen-center/frontend/src/router.ts`
- Create: `big-screen-center/frontend/src/api.ts`
- Create: `big-screen-center/frontend/src/styles/base.css`
- Create: `big-screen-center/frontend/src/composables/useScreenScale.ts`
- Create: `big-screen-center/frontend/src/composables/usePerformanceProfile.ts`
- Create: `big-screen-center/frontend/src/composables/useDataChannel.ts`
- Create: `big-screen-center/frontend/src/registry/widgets.ts`
- Create: `big-screen-center/frontend/src/components/widgets/WidgetHost.vue`
- Test: `big-screen-center/frontend/tests/screen-scale.test.ts`
- Test: `big-screen-center/frontend/tests/performance-profile.test.ts`
- Test: `big-screen-center/frontend/tests/widget-host.test.ts`

- [ ] **Step 1: 写双布局和性能降级失败测试**

```ts
it('selects ultrawide at 24:9 and preserves aspect ratio', () => {
  const result = calculateScreenTransform(3840, 1080)
  expect(result.layout).toBe('ultrawide')
  expect(result.designWidth).toBe(3840)
  expect(result.scaleX).toBe(result.scaleY)
})

it('drops from high to medium after sustained low fps', () => {
  const detector = createPerformanceDetector('high')
  Array.from({ length: 180 }, () => detector.sample(35))
  expect(detector.profile()).toBe('medium')
})
```

- [ ] **Step 2: 运行前端底座测试确认失败**

Run: `npm --prefix big-screen-center/frontend test -- --run tests/screen-scale.test.ts tests/performance-profile.test.ts tests/widget-host.test.ts`

Expected: FAIL，缩放、性能检测和组件注册表不存在。

- [ ] **Step 3: 实现缩放规则**

```ts
export function calculateScreenTransform(viewportWidth: number, viewportHeight: number) {
  const ratio = viewportWidth / viewportHeight
  const layout = ratio >= 2.5 ? 'ultrawide' : 'widescreen'
  const designWidth = layout === 'ultrawide' ? 3840 : 1920
  const designHeight = 1080
  const scale = Math.min(viewportWidth / designWidth, viewportHeight / designHeight)
  return {
    layout,
    designWidth,
    designHeight,
    scaleX: scale,
    scaleY: scale,
    offsetX: (viewportWidth - designWidth * scale) / 2,
    offsetY: (viewportHeight - designHeight * scale) / 2,
  } as const
}
```

- [ ] **Step 4: 建立白名单组件注册表**

```ts
export const widgetRegistry = {
  'metric-cards': () => import('../components/widgets/MetricCards.vue'),
  echart: () => import('../components/widgets/EChartPanel.vue'),
  'three-scene': () => import('../components/widgets/ThreeScene.vue'),
  graph: () => import('../components/widgets/GraphPanel.vue'),
  map: () => import('../components/widgets/MapPanel.vue'),
  'status-matrix': () => import('../components/widgets/StatusMatrix.vue'),
  'ranking-table': () => import('../components/widgets/RankingTable.vue'),
} as const
```

`WidgetHost.vue` 只允许从该对象解析组件；未知类型显示明确错误卡，不执行数据库中的任何字符串。

- [ ] **Step 5: 运行测试和构建**

Run:

```bash
npm --prefix big-screen-center/frontend test -- --run tests/screen-scale.test.ts tests/performance-profile.test.ts tests/widget-host.test.ts
npm --prefix big-screen-center/frontend run build
```

Expected: 测试 PASS，Vite 构建成功。

- [ ] **Step 6: 提交渲染底座**

```bash
git add big-screen-center/frontend
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(big-screen): add responsive rendering shell"
```

### Task 7: 完成三套标杆模板和 Three.js 降级

**Files:**
- Create: `big-screen-center/frontend/src/scenes/createRiskGlobe.ts`
- Create: `big-screen-center/frontend/src/scenes/createCourseGalaxy.ts`
- Create: `big-screen-center/frontend/src/scenes/createExpiryOrbit.ts`
- Create: `big-screen-center/frontend/src/registry/scenes.ts`
- Create: `big-screen-center/frontend/src/components/widgets/ThreeScene.vue`
- Create: `big-screen-center/frontend/src/components/widgets/EChartPanel.vue`
- Create: `big-screen-center/frontend/src/components/widgets/MetricCards.vue`
- Create: `big-screen-center/frontend/src/components/ScreenPlayer.vue`
- Create: `big-screen-center/frontend/src/views/PlayerView.vue`
- Test: `big-screen-center/frontend/e2e/player-layouts.spec.ts`
- Test: `big-screen-center/frontend/e2e/degradation.spec.ts`

- [ ] **Step 1: 写标杆模板可见性和降级 E2E**

```ts
for (const id of ['sca-01', 'train-01', 'remind-01']) {
  test(`${id} renders both layouts`, async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto(`/play/${id}?mock=1`)
    await expect(page.locator('[data-screen-layout="widescreen"]')).toBeVisible()
    await page.setViewportSize({ width: 3840, height: 1080 })
    await page.reload()
    await expect(page.locator('[data-screen-layout="ultrawide"]')).toBeVisible()
  })
}

test('webgl failure preserves primary metrics', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'WebGLRenderingContext', { value: undefined }) })
  await page.goto('/play/sca-01?mock=1')
  await expect(page.locator('[data-three-fallback="risk-globe"]')).toBeVisible()
  await expect(page.locator('[data-widget="metric-cards"]')).toBeVisible()
})
```

- [ ] **Step 2: 运行 E2E 确认失败**

Run: `npm --prefix big-screen-center/frontend run test:e2e -- e2e/player-layouts.spec.ts e2e/degradation.spec.ts`

Expected: FAIL，播放器和场景尚不存在。

- [ ] **Step 3: 实现场景生命周期统一接口**

```ts
export interface ManagedScene {
  start(): void
  pause(): void
  resize(width: number, height: number, pixelRatio: number): void
  update(data: unknown): void
  dispose(): void
}

export const sceneRegistry = {
  'risk-globe': () => import('../scenes/createRiskGlobe'),
  'course-galaxy': () => import('../scenes/createCourseGalaxy'),
  'expiry-orbit': () => import('../scenes/createExpiryOrbit'),
} as const
```

每个场景使用单个 `requestAnimationFrame`，`document.visibilitychange` 暂停；`dispose()` 逐个释放 geometry、material、texture、renderer 和事件监听。`high/medium/low` 的最大像素比分别为 `1.75/1.25/1`，粒子数分别为 `6000/2500/0`。

- [ ] **Step 4: 实现三个场景的业务语义**

- `risk-globe`：风险等级映射轨道颜色和脉冲强度，项目数映射节点数量。
- `course-galaxy`：课程为轨道、参训人数为星体尺寸、完成率为轨道亮度。
- `expiry-orbit`：7/30/60/90 天为四层时间环，风险金额映射弧长。
- 低档或 WebGL 失败时，使用 ECharts 极坐标图表达相同数据，不显示伪随机业务数字。

- [ ] **Step 5: 截图验证四种分辨率**

Run:

```bash
npm --prefix big-screen-center/frontend run test:e2e -- e2e/player-layouts.spec.ts e2e/degradation.spec.ts
```

Expected: `1920x1080`、`3840x1080`、WebGL 降级测试 PASS；截图中无裁切、拉伸和空白核心区域。

- [ ] **Step 6: 提交标杆模板**

```bash
git add big-screen-center/frontend
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(big-screen): add three flagship screens"
```

### Task 8: 补齐其余九套模板和开源视觉插件

**Files:**
- Create: `big-screen-center/frontend/src/components/widgets/GraphPanel.vue`
- Create: `big-screen-center/frontend/src/components/widgets/MapPanel.vue`
- Create: `big-screen-center/frontend/src/components/widgets/StatusMatrix.vue`
- Create: `big-screen-center/frontend/src/components/widgets/RankingTable.vue`
- Create: `big-screen-center/frontend/src/components/widgets/TechFrame.vue`
- Modify: `big-screen-center/frontend/src/templates/manifests.ts`
- Modify: `big-screen-center/frontend/src/registry/scenes.ts`
- Test: `big-screen-center/frontend/tests/manifests.test.ts`
- Test: `big-screen-center/frontend/e2e/player-layouts.spec.ts`

- [ ] **Step 1: 扩充测试，要求 12 套均有差异化组件组合**

```ts
it('does not ship recolored duplicates', () => {
  const signatures = manifests.map((template) =>
    template.widgets.map((widget) => `${widget.type}:${widget.config.variant}`).sort().join('|')
  )
  expect(new Set(signatures).size).toBe(12)
})

it('keeps one persistent three scene at most', () => {
  for (const template of manifests) {
    expect(template.widgets.filter((widget) => widget.type === 'three-scene')).toHaveLength(
      template.widgets.some((widget) => widget.type === 'three-scene') ? 1 : 0
    )
  }
})
```

- [ ] **Step 2: 运行测试确认现有三套不足**

Run: `npm --prefix big-screen-center/frontend test -- --run tests/manifests.test.ts`

Expected: FAIL，模板数量或签名数量不是 `12`。

- [ ] **Step 3: 按固定插件矩阵完成九套模板**

| 模板 | 核心插件 | 固定核心组件 |
| --- | --- | --- |
| SCA 02 | ECharts GL + tsParticles | 威胁雷达、漏洞时间河流、KEV/PoC 指标 |
| SCA 03 | Three.js + G6 | 空间依赖网络、传播路径、许可证风险排行 |
| SCA 04 | Three.js + ECharts | 扫描流水线、任务矩阵、耗时和缓存趋势 |
| SCA 05 | Anime.js + ECharts | 安全航线、成果里程碑、治理趋势 |
| TRAIN 02 | ECharts + SSE | 考试舱位矩阵、倒计时、异常会话流 |
| TRAIN 03 | ECharts GL + G6 | 能力地形、知识图谱、部门薄弱项 |
| TRAIN 04 | Three.js + Anime.js | 成长阶梯、荣誉墙、年度成果 |
| REMIND 02 | G6 + ECharts | 消息流管道、渠道网络、失败重试 |
| REMIND 03 | MapLibre + G6 + ECharts | 客户地图、关系图、机会漏斗 |

`TechFrame.vue` 是 DataV 的唯一适配层，只暴露 `border-box`、`decoration-line`、`digital-title` 三种变体。MapLibre 默认读取 `/assets/maps/style-offline.json` 和本地 GeoJSON，外部瓦片地址不能来自模板配置。

- [ ] **Step 4: 为所有模板补齐双布局截图**

Playwright 参数化遍历 `TEMPLATE_BLUEPRINTS`，分别在 `1920x1080` 和 `3840x1080` 打开并断言：

```ts
await expect(page.locator('[data-screen-ready="true"]')).toBeVisible()
await expect(page.locator('[data-source-status]')).toHaveCount(1)
await expect(page.locator('[data-widget-error="true"]')).toHaveCount(0)
```

- [ ] **Step 5: 运行 12 套模板测试**

Run:

```bash
npm --prefix big-screen-center/frontend test -- --run tests/manifests.test.ts
npm --prefix big-screen-center/frontend run test:e2e -- e2e/player-layouts.spec.ts
```

Expected: 12 套清单测试和 24 个布局用例 PASS。

- [ ] **Step 6: 提交完整模板库**

```bash
git add big-screen-center/frontend
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(big-screen): complete twelve screen templates"
```

### Task 9: 实现有限编排、草稿、发布和回滚

**Files:**
- Create: `big-screen-center/backend/src/routes/templates.ts`
- Create: `big-screen-center/frontend/src/components/ScreenEditor.vue`
- Create: `big-screen-center/frontend/src/views/EditorView.vue`
- Test: `big-screen-center/backend/tests/template-store.test.ts`
- Test: `big-screen-center/frontend/tests/editor-constraints.test.ts`
- Test: `big-screen-center/frontend/e2e/editor-playlist.spec.ts`

- [ ] **Step 1: 写越界移动、隐藏必需组件和非法配置测试**

```ts
it('rejects moving a widget outside declared areas', () => {
  expect(() => applyEdit(template, {
    widgetId: 'risk-globe',
    layout: 'widescreen',
    area: 'undeclared-area',
  })).toThrow('Layout area is not allowed')
})

it('rejects hiding required widgets', () => {
  expect(() => applyEdit(template, {
    widgetId: 'risk-globe',
    hidden: true,
  })).toThrow('Required widget cannot be hidden')
})
```

- [ ] **Step 2: 运行编辑器测试确认失败**

Run: `npm --prefix big-screen-center/frontend test -- --run tests/editor-constraints.test.ts`

Expected: FAIL，编辑约束函数不存在。

- [ ] **Step 3: 实现允许的编辑命令**

```ts
export type EditorCommand =
  | { type: 'set-hidden'; widgetId: string; hidden: boolean }
  | { type: 'set-position'; widgetId: string; layout: 'widescreen' | 'ultrawide'; area: string; x: number; y: number }
  | { type: 'set-size'; widgetId: string; layout: 'widescreen' | 'ultrawide'; width: number; height: number }
  | { type: 'set-filter'; key: string; value: string | string[] }
  | { type: 'set-theme'; themeKey: string }
  | { type: 'set-effects'; profile: 'high' | 'medium' | 'low' }
```

GridStack 只接收模板换算出的 `minW/minH/maxW/maxH` 和允许区域。保存草稿、预览、发布、恢复默认都调用 BFF；发布生成新版本，回滚通过重新发布历史配置实现，不修改历史行。

- [ ] **Step 4: 加入审计动作**

固定动作：

```text
template.draft.save
template.publish
template.restore-default
template.rollback
```

审计详情记录模板 ID、版本、变更字段和请求 ID，不记录 cookie 或业务数据内容。

- [ ] **Step 5: 验证编辑和发布**

Run:

```bash
npm --prefix big-screen-center/backend test -- --run tests/template-store.test.ts
npm --prefix big-screen-center/frontend test -- --run tests/editor-constraints.test.ts
npm --prefix big-screen-center/frontend run test:e2e -- e2e/editor-playlist.spec.ts
```

Expected: 约束测试 PASS；发布后历史版本仍可读取。

- [ ] **Step 6: 提交有限编排**

```bash
git add big-screen-center/backend big-screen-center/frontend
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(big-screen): add constrained screen editor"
```

### Task 10: 实现播放列表、全屏控制和异常跳转

**Files:**
- Create: `big-screen-center/backend/src/routes/playlists.ts`
- Create: `big-screen-center/frontend/src/components/PlaylistPanel.vue`
- Modify: `big-screen-center/frontend/src/components/ScreenPlayer.vue`
- Test: `big-screen-center/backend/tests/playlist-store.test.ts`
- Test: `big-screen-center/frontend/tests/playlist-panel.test.ts`
- Test: `big-screen-center/frontend/e2e/editor-playlist.spec.ts`

- [ ] **Step 1: 写播放顺序、暂停恢复和失败跳转测试**

```ts
it('skips a failed item and preserves elapsed schedule', () => {
  const controller = createPlaylistController([
    { templateId: 'sca-01', version: 2, durationSeconds: 30, transition: 'fade' },
    { templateId: 'train-01', version: 1, durationSeconds: 20, transition: 'slide' },
  ])
  controller.failCurrent()
  expect(controller.current().templateId).toBe('train-01')
})
```

- [ ] **Step 2: 运行播放列表测试确认失败**

Run: `npm --prefix big-screen-center/frontend test -- --run tests/playlist-panel.test.ts`

Expected: FAIL，控制器和面板不存在。

- [ ] **Step 3: 实现播放列表约束**

每项结构固定为：

```ts
interface PlaylistItem {
  templateId: string
  version: number
  durationSeconds: number
  transition: 'fade' | 'slide' | 'zoom'
  filters: Record<string, string | string[]>
}
```

`durationSeconds` 限制 `10..1800`；模板版本必须已发布且用户仍拥有对应业务系统权限。键盘支持 `Space` 暂停/恢复、`ArrowRight` 下一项、`ArrowLeft` 上一项、`F` 全屏、`Escape` 退出控制层。

播放列表的定时规则固定为：

```ts
interface PlaylistSchedule {
  timezone: 'Asia/Shanghai'
  daysOfWeek: Array<1 | 2 | 3 | 4 | 5 | 6 | 7>
  startTime: `${number}${number}:${number}${number}`
  endTime: `${number}${number}:${number}${number}`
}
```

BFF 校验开始时间早于结束时间，并以 `Asia/Shanghai` 计算是否应自动播放；同一播放列表不允许重叠规则。

- [ ] **Step 4: 实现异常行为**

- 单模板渲染失败：记录前端错误事件，5 秒内跳到下一项。
- 全部模板失败：显示数据源健康页。
- 浏览器重新可见：按绝对时间重新计算当前项，不从头累计漂移。
- SSE 中断：切换到对应指标的轮询间隔。
- 手机宽度小于 `768px` 时只提供模板目录、当前播放状态、上一项/下一项、暂停/恢复和退出；访问编辑器自动返回目录并提示“请在桌面端编辑”。

- [ ] **Step 5: 运行播放列表测试**

Run:

```bash
npm --prefix big-screen-center/backend test -- --run tests/playlist-store.test.ts
npm --prefix big-screen-center/frontend test -- --run tests/playlist-panel.test.ts
npm --prefix big-screen-center/frontend run test:e2e -- e2e/editor-playlist.spec.ts
```

Expected: PASS。

- [ ] **Step 6: 提交播放能力**

```bash
git add big-screen-center/backend big-screen-center/frontend
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(big-screen): add resilient playlist playback"
```

### Task 11: 完成离线资源、数据健康、安全和运维接口

**Files:**
- Create: `big-screen-center/backend/src/routes/health.ts`
- Create: `big-screen-center/backend/src/resource-pack-store.ts`
- Create: `big-screen-center/frontend/src/components/SourceHealthBar.vue`
- Create: `big-screen-center/assets/geojson/china-provinces.json`
- Create: `big-screen-center/assets/maps/style-offline.json`
- Create: `big-screen-center/deploy/env.example`
- Create: `big-screen-center/README.md`
- Modify: `big-screen-center/deploy/verify-offline-assets.mjs`
- Test: `big-screen-center/backend/tests/data-route.test.ts`
- Test: `big-screen-center/frontend/e2e/degradation.spec.ts`

- [ ] **Step 1: 写离线和健康状态失败测试**

```ts
test('offline mode makes no third-party requests', async ({ page }) => {
  const external: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) external.push(request.url())
  })
  await page.goto('/play/remind-03?mock=1&offline=1')
  await expect(page.locator('[data-screen-ready="true"]')).toBeVisible()
  expect(external).toEqual([])
})

test('mobile exposes playback controls but not editor canvas', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/playlists/1?mock=1')
  await expect(page.locator('[data-mobile-playback-controls]')).toBeVisible()
  await page.goto('/edit/sca-01?mock=1')
  await expect(page).toHaveURL(/\/catalog/)
})
```

- [ ] **Step 2: 运行降级测试确认失败**

Run: `npm --prefix big-screen-center/frontend run test:e2e -- e2e/degradation.spec.ts`

Expected: FAIL，本地地图资源或健康组件尚不完整。

- [ ] **Step 3: 实现健康接口**

`GET /api/big-screen/health` 返回：

```json
{
  "status": "ok",
  "database": "ok",
  "sources": {
    "sca": { "status": "ok", "latencyMs": 42, "lastSuccessAt": "2026-06-10T05:00:00.000Z" },
    "train-exam": { "status": "stale", "latencyMs": null, "lastSuccessAt": "2026-06-10T04:58:00.000Z" },
    "reminder": { "status": "ok", "latencyMs": 31, "lastSuccessAt": "2026-06-10T05:00:00.000Z" }
  }
}
```

播放器始终显示数据生成时间和 `ok/partial/stale/empty/error`，不能用演示随机数覆盖生产错误。

- [ ] **Step 4: 实现签名资源包和联网增强白名单**

资源包清单格式固定为：

```json
{
  "packKey": "juxin-core-visuals",
  "version": 1,
  "files": [
    { "path": "fonts/SourceHanSansSC-Regular.woff2", "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08" },
    { "path": "geojson/china-provinces.json", "sha256": "60303ae22b9988617223a80e9d7cc0e8025d8464ae3ddf16256ba1cbb2c64317" }
  ]
}
```

BFF 使用 `BIG_SCREEN_RESOURCE_PUBLIC_KEY` 指定的 Ed25519 公钥验证清单签名，再逐文件核对 SHA-256；路径必须位于 `assets/`，拒绝 `..`、绝对路径和符号链接。只有 `sysadmin` 可上传、启用或回滚资源包，动作写入审计日志。

联网增强只允许 `BIG_SCREEN_EXTERNAL_ORIGIN_ALLOWLIST` 中的 HTTPS 域名；默认值为空。未配置白名单、请求失败或断网时，MapLibre 和地理信息自动使用本地资源。

- [ ] **Step 5: 验证离线资源完整性**

`verify-offline-assets.mjs` 检查所有模板引用的字体、GeoJSON、地图样式、纹理和模型都位于 `big-screen-center/assets`，并拒绝 `http://`、`https://`、协议相对 URL。

Run: `node big-screen-center/deploy/verify-offline-assets.mjs`

Expected: 输出 `offline assets verified: 12 templates`。

- [ ] **Step 6: 运行健康、手机控制和离线测试**

Run:

```bash
npm --prefix big-screen-center/backend test -- --run tests/data-route.test.ts
npm --prefix big-screen-center/frontend run test:e2e -- e2e/degradation.spec.ts
node big-screen-center/deploy/verify-offline-assets.mjs
```

Expected: 全部 PASS。

- [ ] **Step 7: 提交离线和运维能力**

```bash
git add big-screen-center
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(big-screen): add offline assets and health"
```

### Task 12: 全量验证、浏览器验收、版本升级和推送

**Files:**
- Modify: `README.md`
- Modify: `docs/versioning.md`
- Modify: 自动版本脚本覆盖的 package 文件
- Create: `big-screen-center/frontend/e2e/visual-baselines/`

- [ ] **Step 1: 运行静态检查、单元测试和构建**

Run:

```bash
node --test auth/tests/portal-routing.test.js auth/tests/system-access-display.test.js auth/tests/big-screen-authorization.test.js auth/tests/big-screen-portal-source.test.js
npm --prefix big-screen-center/backend run test:run
npm --prefix big-screen-center/backend run build
npm --prefix big-screen-center/frontend run test:run
npm --prefix big-screen-center/frontend run build
docker compose config --quiet
node big-screen-center/deploy/verify-offline-assets.mjs
```

Expected: 所有命令退出码 `0`。

- [ ] **Step 2: 启动首期服务并做浏览器验收**

Run:

```bash
docker compose up -d --build auth api train-exam-api sca-api big-screen-api web-big-screen
docker compose ps
```

Expected: 六个服务均为 `Up`，大屏入口为 `http://localhost:18092`。

使用 Codex in-app Browser 验证：

- 模板中心只显示当前用户有权访问的系统。
- 12 套模板卡均有缩略图、场景、分辨率、特效等级、数据状态和更新时间。
- `sca-01`、`train-01`、`remind-01` 的 Three.js 场景可运行并可切低性能模式。
- 编辑器不能隐藏核心组件或越界移动。
- 播放列表可暂停、恢复、前后切换和进入全屏。

- [ ] **Step 3: 运行分辨率和视觉基线**

Run:

```bash
npm --prefix big-screen-center/frontend run test:e2e -- e2e/catalog.spec.ts e2e/player-layouts.spec.ts e2e/degradation.spec.ts e2e/editor-playlist.spec.ts
```

Expected: `1920x1080`、`3840x1080`、`3840x2160`、`7680x2160` 用例全部 PASS。

- [ ] **Step 4: 执行稳定性验证**

新增 Playwright 长稳脚本，以 `BIG_SCREEN_STABILITY_MINUTES=1440` 运行生产验收；开发阶段先用 `BIG_SCREEN_STABILITY_MINUTES=30`。验收指标：

```text
首屏：1080p <= 3s，4K <= 5s
帧率：高/中档常态 >= 50 FPS，低档 >= 30 FPS
内存：24 小时线性增长 <= 10%
SSE：中断后 30s 内恢复或进入轮询
模板失败：5s 内切换下一项
外部请求：离线模式为 0
```

- [ ] **Step 5: 检查变更范围**

Run:

```bash
git status --short
git diff --check
git diff --stat
```

Expected: 只包含 `big-screen-center/`、认证增量、Compose、README 和自动版本文件；不包含 `.superpowers/`、`dist/`、`test-results/` 或其他既有未跟踪文件。

- [ ] **Step 6: 创建最终功能提交并让版本自动化执行**

```bash
git add big-screen-center auth docker-compose.yml README.md docs/versioning.md
git commit -m "feat(big-screen): deliver unified display center"
```

Expected:

- post-commit 将当前版本按“功能优化”规则升第二位，例如 `5.69.2 -> 5.70.0`。
- 提交标题被改写为 `[v5.70.0] feat(big-screen): deliver unified display center`。
- 分支切换到 `codex/5.70.0`。
- 自动推送 `origin/codex/5.70.0`。

- [ ] **Step 7: 确认提交和远端一致**

Run:

```bash
git status --short
git branch --show-current
git log -1 --oneline
git rev-parse HEAD
git rev-parse origin/$(git branch --show-current)
```

Expected: 工作区只剩实施前已有未跟踪文件；本地 HEAD 与远端分支 SHA 完全一致。

## 3. 分阶段验收点

1. **阶段一：底座和标杆模板**
   - Task 1-7 完成。
   - 三个系统各一套模板可播放，双布局和 WebGL 降级通过。
2. **阶段二：完整模板库**
   - Task 8 完成。
   - 12 套模板全部可用，插件矩阵和视觉差异测试通过。
3. **阶段三：运营能力**
   - Task 9-10 完成。
   - 草稿、发布、回滚、播放列表和审计可用。
4. **阶段四：生产准备**
   - Task 11-12 完成。
   - 离线、健康、性能、稳定性、版本、提交和推送全部通过。

## 4. 实施注意事项

- 不修改三个业务系统数据库结构，也不在 BFF 中使用其数据库账号。
- `GET /api/sales-license-overview` 当前要求 `admin`；提醒 Adapter 必须按现有角色约束处理，不得通过共享数据库绕过。
- 用户没有某业务系统权限时，目录、模板详情、数据接口和 SSE 都返回 `403` 或不展示，不能只靠前端隐藏。
- 生产日志不得输出 cookie、JWT、数据库密码、上游完整响应或客户敏感字段。
- Three.js、G6、MapLibre 和 ECharts 实例在模板切换时必须释放，24 小时验收前先执行 30 分钟内存曲线测试。
- DataV Vue3 只用于装饰适配层；若安装、构建或许可证复核失败，删除该依赖并保持 `TechFrame.vue` 的公开属性不变，其他模板代码不改。
- 不将 `.superpowers/brainstorm` 效果图作为运行时资产；生产素材全部进入 `big-screen-center/assets` 并通过离线校验。
