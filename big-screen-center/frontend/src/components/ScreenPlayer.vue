<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, toRef, watch } from 'vue'

import { useDataChannel } from '../composables/useDataChannel'
import { usePerformanceProfile } from '../composables/usePerformanceProfile'
import { useScreenScale } from '../composables/useScreenScale'
import { provideScreenInteraction } from '../interactions/useScreenInteraction'
import {
  navigateToUnifiedLogin,
  previewData,
} from '../preview-data'
import type { JsonValue, ScreenTemplate } from '../types'
import InteractionConsole from './InteractionConsole.vue'
import SourceHealthBar from './SourceHealthBar.vue'
import WidgetHost from './widgets/WidgetHost.vue'

const props = defineProps<{
  template: ScreenTemplate
}>()

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
const redirectingToLogin = ref(false)
const channel = useDataChannel({
  systemKey,
  metricKey,
  filters,
  mode,
  intervalMs,
  enabled: channelEnabled,
  onUnauthorized: () => {
    if (redirectingToLogin.value || typeof window === 'undefined') return
    redirectingToLogin.value = true
    navigateToUnifiedLogin(window.location.href)
  },
})
watch(
  [channel.errorStatusCode, channel.error, isMock],
  ([statusCode, errorMessage, mockMode]) => {
    if (
      mockMode
      || redirectingToLogin.value
      || typeof window === 'undefined'
      || (statusCode !== 401 && errorMessage !== '请先登录')
    ) {
      return
    }
    redirectingToLogin.value = true
    navigateToUnifiedLogin(window.location.href)
  },
)
const usePreviewData = computed(() => isMock.value)
const data = computed<JsonValue>(() =>
  usePreviewData.value
    ? previewData[props.template.systemKey]
    : channel.envelope.value?.data || {},
)
const interaction = provideScreenInteraction(
  toRef(props, 'template'),
  data,
  filters,
)
const dataStatus = computed(() => {
  if (usePreviewData.value) return 'mock' as const
  if (channel.envelope.value) return channel.envelope.value.status
  return channel.state.value === 'loading' ? 'loading' : 'error'
})
const generatedAt = computed(() =>
  usePreviewData.value
    ? new Date().toISOString()
    : channel.envelope.value?.generatedAt || null,
)
const stale = computed(() => usePreviewData.value
  ? false
  : channel.envelope.value?.stale || false)
const unavailableSources = computed(() => usePreviewData.value
  ? []
  : channel.envelope.value?.unavailableSources || [])
const canvasStyle = computed(() => ({
  width: `${transform.value.designWidth}px`,
  height: `${transform.value.designHeight}px`,
  transform: `translate(${transform.value.offsetX}px, ${transform.value.offsetY}px) scale(${transform.value.scaleX})`,
}))

const metricValue = (key: string) => {
  const current = data.value
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    return undefined
  }
  const value = current[key]
  return typeof value === 'number' || typeof value === 'string'
    ? value
    : undefined
}
const lockedTarget = computed(() => interaction.snapshot.value.locked)
const relatedMetrics = computed(() => {
  const locked = lockedTarget.value
  if (!locked) return []
  const byKey = new Map(
    props.template.interactions.map((item) => [item.key, item]),
  )
  return locked.relatedKeys
    .map((key) => byKey.get(key))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .map((item) => ({
      ...item,
      value: metricValue(item.key),
      unit: item.key.toLowerCase().includes('rate') ? '%' : undefined,
    }))
})

const clearInteraction = () => interaction.clear()
const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') clearInteraction()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <main class="screen-stage">
    <section
      class="screen-canvas"
      :class="`screen-canvas--${template.systemKey}`"
      :style="canvasStyle"
      :data-screen-layout="transform.layout"
      data-screen-ready="true"
      @click.self="clearInteraction"
    >
      <header class="screen-heading">
        <div>
          <span>聚信 / 可视化运营</span>
          <h1>{{ template.name }}</h1>
        </div>
        <div class="screen-heading__meta">
          <SourceHealthBar
            :status="dataStatus"
            :generated-at="generatedAt"
            :stale="stale"
            :unavailable-sources="unavailableSources"
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

      <InteractionConsole
        :target="lockedTarget"
        :related="relatedMetrics"
        :system-key="template.systemKey"
        @close="clearInteraction"
      />
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
