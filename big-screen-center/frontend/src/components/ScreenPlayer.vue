<script setup lang="ts">
import { computed, ref } from 'vue'

import { useDataChannel } from '../composables/useDataChannel'
import { usePerformanceProfile } from '../composables/usePerformanceProfile'
import { useScreenScale } from '../composables/useScreenScale'
import type { JsonValue, ScreenTemplate } from '../types'
import SourceHealthBar from './SourceHealthBar.vue'
import WidgetHost from './widgets/WidgetHost.vue'

const props = defineProps<{
  template: ScreenTemplate
}>()

const mockData: Record<string, Record<string, JsonValue>> = {
  sca: {
    totalProjects: 6631,
    criticalRisks: 48,
    vulnerableComponents: 1276,
    healthyRate: 86,
    high: 48,
    medium: 179,
    low: 463,
  },
  'train-exam': {
    activeCourses: 128,
    learners: 8426,
    completionRate: 91,
    certificates: 3268,
    mandatory: 96,
    elective: 72,
    overdue: 17,
  },
  reminder: {
    expiring7d: 42,
    expiring30d: 186,
    riskAmount: 2680,
    deliveryRate: 94,
    day7: 42,
    day30: 186,
    day60: 324,
    day90: 491,
  },
}

const { transform } = useScreenScale()
const { profile } = usePerformanceProfile(props.template.effectsProfile)
const performanceProfile = computed(() => {
  const forced = import.meta.env.DEV
    ? window.sessionStorage.getItem('big-screen-profile')
    : null
  return forced === 'high' || forced === 'medium' || forced === 'low'
    ? forced
    : profile.value
})
const filters = ref<Record<string, JsonValue>>({})
const systemKey = computed(() => props.template.systemKey)
const metricKey = computed(() => props.template.widgets[0]?.dataSourceKey || '')
const mode = computed(() => props.template.refreshPolicy.mode)
const intervalMs = computed(() => props.template.refreshPolicy.intervalMs)
const isMock = computed(() =>
  typeof window !== 'undefined'
  && (
    new URLSearchParams(window.location.search).get('mock') === '1'
    || (
      import.meta.env.DEV
      && window.sessionStorage.getItem('big-screen-mock') === '1'
    )
  ),
)
const channelEnabled = computed(() => !isMock.value)
const channel = useDataChannel({
  systemKey,
  metricKey,
  filters,
  mode,
  intervalMs,
  enabled: channelEnabled,
})
const data = computed<JsonValue>(() =>
  isMock.value
    ? mockData[props.template.systemKey]
    : channel.envelope.value?.data || {},
)
const dataStatus = computed(() => {
  if (isMock.value) return 'mock' as const
  if (channel.envelope.value) return channel.envelope.value.status
  return channel.state.value === 'loading' ? 'loading' : 'error'
})
const generatedAt = computed(() =>
  isMock.value
    ? new Date().toISOString()
    : channel.envelope.value?.generatedAt || null,
)
const canvasStyle = computed(() => ({
  width: `${transform.value.designWidth}px`,
  height: `${transform.value.designHeight}px`,
  transform: `translate(${transform.value.offsetX}px, ${transform.value.offsetY}px) scale(${transform.value.scaleX})`,
}))
</script>

<template>
  <main class="screen-stage">
    <section
      class="screen-canvas"
      :class="`screen-canvas--${template.systemKey}`"
      :style="canvasStyle"
      :data-screen-layout="transform.layout"
      data-screen-ready="true"
    >
      <header class="screen-heading">
        <div>
          <span>JX / VISUAL OPERATIONS</span>
          <h1>{{ template.name }}</h1>
        </div>
        <div class="screen-heading__meta">
          <SourceHealthBar
            :status="dataStatus"
            :generated-at="generatedAt"
            :stale="channel.envelope.value?.stale || false"
            :unavailable-sources="channel.envelope.value?.unavailableSources || []"
          />
          <strong>{{ new Date().toLocaleDateString('zh-CN') }}</strong>
          <RouterLink class="screen-exit" to="/">模板目录</RouterLink>
        </div>
      </header>

      <section class="screen-grid">
        <div
          v-for="widget in template.widgets"
          :key="widget.id"
          class="screen-grid__area"
          :class="`screen-grid__area--${widget.layoutArea}`"
        >
          <WidgetHost
            :widget="widget"
            :data="data"
            :performance-profile="performanceProfile"
          />
        </div>
      </section>
    </section>
  </main>
</template>

<style scoped>
.screen-stage {
  position: fixed;
  inset: 0;
  z-index: 100;
  overflow: hidden;
  background: #100e0b;
}

.screen-canvas {
  --screen-accent: #f2b84b;
  --screen-signal: #b8d26f;
  --screen-muted: #a99b84;
  --screen-line: rgb(216 190 146 / 20%);
  position: absolute;
  left: 0;
  top: 0;
  padding: 38px 52px 42px;
  color: #f4ead7;
  background:
    linear-gradient(90deg, rgb(255 255 255 / 2%) 1px, transparent 1px) 0 0 / 72px 72px,
    linear-gradient(rgb(255 255 255 / 2%) 1px, transparent 1px) 0 0 / 72px 72px,
    radial-gradient(circle at 50% 30%, #352a1c 0, #17130e 48%, #0f0d0a 100%);
  transform-origin: left top;
}

.screen-canvas--train-exam {
  --screen-accent: #73c6a6;
  --screen-signal: #f4c65e;
}

.screen-canvas--reminder {
  --screen-accent: #ff775d;
  --screen-signal: #f2b84b;
}

.screen-heading {
  height: 94px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  border-bottom: 1px solid var(--screen-line);
}

.screen-heading span {
  color: var(--screen-muted);
  font-size: 11px;
  letter-spacing: 0.22em;
}

.screen-heading h1 {
  margin: 8px 0 0;
  font-family: var(--font-display);
  font-size: 38px;
  font-weight: 500;
  letter-spacing: 0.05em;
}

.screen-heading__meta {
  display: grid;
  justify-items: end;
  gap: 10px;
}

.screen-heading__meta strong {
  font-size: 16px;
  font-weight: 500;
}

.screen-exit {
  color: var(--screen-accent);
  font-size: 10px;
  letter-spacing: 0.16em;
  text-decoration: none;
}

.screen-exit:hover {
  text-decoration: underline;
  text-underline-offset: 5px;
}

.screen-grid {
  height: calc(100% - 118px);
  display: grid;
  grid-template:
    "metrics metrics metrics" 154px
    "trend core ranking" minmax(0, 1fr)
    "trend health ranking" 126px
    / 430px minmax(0, 1fr) 430px;
  gap: 18px;
  padding-top: 24px;
}

.screen-grid__area {
  min-width: 0;
  min-height: 0;
}

.screen-grid__area > :deep(*) {
  height: 100%;
}

.screen-grid__area--metrics { grid-area: metrics; }
.screen-grid__area--core { grid-area: core; }
.screen-grid__area--trend { grid-area: trend; }
.screen-grid__area--ranking { grid-area: ranking; }
.screen-grid__area--health { grid-area: health; }

.screen-canvas[data-screen-layout="ultrawide"] .screen-grid {
  grid-template:
    "metrics core ranking" 154px
    "trend core ranking" minmax(0, 1fr)
    "trend core health" 190px
    / 820px minmax(0, 1fr) 820px;
}
</style>
