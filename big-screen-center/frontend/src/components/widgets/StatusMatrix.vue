<script setup lang="ts">
import { computed } from 'vue'

import { useScreenInteraction } from '../../interactions/useScreenInteraction'
import type { EffectsProfile, InteractionSource, JsonValue, WidgetDefinition } from '../../types'
import { metricLabel, numericMetricEntries, widgetTitle } from '../../metric-labels'
import TechFrame from './TechFrame.vue'

const props = defineProps<{
  widget: WidgetDefinition
  data: JsonValue
  performanceProfile: EffectsProfile
}>()
const interaction = useScreenInteraction()

const cells = computed(() => {
  return numericMetricEntries(props.data, 12)
    .map(([key, value]) => ({
      key,
      label: metricLabel(key),
      value,
      level: value === 0 ? 'idle' : value < 10 ? 'alert' : 'healthy',
    }))
})

const title = computed(() => widgetTitle(props.widget.config.variant))
const isHealthMatrix = computed(() =>
  props.widget.layoutArea === 'health'
  || String(props.widget.config.variant || '').endsWith('-health'),
)
const hint = computed(() =>
  isHealthMatrix.value
    ? '下方格子表示关键指标健康度，颜色越亮越需要关注。'
    : '展示业务核心指标的实时规模、发布量和完成情况。',
)
const legendLabel = computed(() =>
  isHealthMatrix.value ? '数据健康矩阵图例' : '实时指标矩阵图例',
)
const source: InteractionSource = 'status-matrix'
const statusText = (level: string) => {
  if (level === 'healthy') return '正常'
  if (level === 'alert') return '关注'
  return '暂无数据'
}
const preview = (key: string, value: number) =>
  interaction.hover(interaction.targetFor(props.widget, key, value, source))
const select = (key: string, value: number) =>
  interaction.lock(interaction.targetFor(props.widget, key, value, source))
const relation = (key: string) => interaction.relationFor(key)
const pressed = (key: string) => interaction.snapshot.value.locked?.key === key
</script>

<template>
  <TechFrame
    class="status-matrix"
    variant="decoration-line"
    :title="title"
    data-widget="status-matrix"
    data-widget-type="status-matrix"
  >
    <p class="status-matrix__hint">{{ hint }}</p>
    <p class="status-matrix__legend" :aria-label="legendLabel">
      <span>正常</span>
      <span>关注</span>
      <span>暂无数据</span>
    </p>
    <div class="status-matrix__grid">
      <span
        v-for="cell in cells"
        :key="cell.key"
        :class="`status-matrix__cell--${cell.level}`"
        role="button"
        tabindex="0"
        :data-interaction-key="cell.key"
        :data-interaction-state="relation(cell.key)"
        :data-performance-profile="performanceProfile"
        :data-status-level="cell.level"
        :aria-pressed="pressed(cell.key)"
        :aria-label="`${cell.label}：${cell.value}，状态${statusText(cell.level)}`"
        :title="`${cell.label}：${cell.value}`"
        @mouseenter="preview(cell.key, cell.value)"
        @mouseleave="interaction.leave()"
        @click.stop="select(cell.key, cell.value)"
        @keydown.enter.prevent="select(cell.key, cell.value)"
        @keydown.space.prevent="select(cell.key, cell.value)"
      >
        <b>{{ cell.label }}</b>
        <small>{{ cell.value }}</small>
      </span>
    </div>
  </TechFrame>
</template>

<style scoped>
.status-matrix__hint {
  margin: 10px 0 0;
  color: color-mix(in srgb, var(--screen-muted), transparent 12%);
  font-size: 10px;
  letter-spacing: 0.08em;
}

.status-matrix__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(74px, 1fr));
  gap: 7px;
  margin-top: 12px;
}

.status-matrix__legend {
  display: flex;
  gap: 12px;
  margin: 8px 0 0;
  color: var(--screen-muted);
  font-size: 10px;
}

.status-matrix__legend span::before {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 5px;
  background: var(--screen-signal);
  content: "";
}

.status-matrix__legend span:nth-child(2)::before {
  background: var(--screen-warning);
}

.status-matrix__legend span:nth-child(3)::before {
  background: color-mix(in srgb, var(--screen-muted), transparent 72%);
}

.status-matrix__grid span {
  display: flex;
  min-height: 36px;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  padding: 6px 8px;
  overflow: hidden;
  background: var(--screen-surface);
  border: 1px solid var(--screen-line);
  box-shadow: 0 10px 28px var(--screen-shadow);
  cursor: pointer;
  transition:
    border-color 180ms ease,
    box-shadow 180ms ease,
    transform 180ms ease;
}

.status-matrix__grid span:focus-visible {
  outline: 2px solid var(--screen-accent);
  outline-offset: 3px;
}

.status-matrix__grid span[data-interaction-state="primary"] {
  border-color: var(--screen-accent);
  box-shadow: 0 0 18px color-mix(in srgb, var(--screen-accent), transparent 62%);
  transform: translateY(-2px);
}

.status-matrix__grid span[data-interaction-state="related"] {
  border-color: color-mix(in srgb, var(--screen-accent), transparent 36%);
}

.status-matrix__grid span[data-performance-profile="low"] {
  box-shadow: none;
  transform: none;
}

.status-matrix__grid b,
.status-matrix__grid small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-matrix__grid b {
  color: var(--screen-text);
  font-size: 10px;
  font-weight: 500;
}

.status-matrix__grid small {
  color: color-mix(in srgb, var(--screen-text), transparent 25%);
  font-family: var(--font-display);
  font-size: 12px;
}

.status-matrix__cell--healthy {
  background: color-mix(in srgb, var(--screen-signal), white 84%) !important;
  box-shadow: none;
}

.status-matrix__cell--alert {
  background: color-mix(in srgb, var(--screen-warning), white 82%) !important;
}

.status-matrix__cell--idle {
  background: var(--screen-idle) !important;
}
</style>
