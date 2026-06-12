<script setup lang="ts">
import { computed } from 'vue'

import type { EffectsProfile, JsonValue, WidgetDefinition } from '../../types'
import { metricLabel, numericMetricEntries, widgetTitle } from '../../metric-labels'
import TechFrame from './TechFrame.vue'

const props = defineProps<{
  widget: WidgetDefinition
  data: JsonValue
  performanceProfile: EffectsProfile
}>()

const cells = computed(() => {
  return numericMetricEntries(props.data, 12)
    .map(([key, value], index) => ({
      key,
      label: metricLabel(key),
      value,
      level: value === 0 ? 'idle' : index % 5 === 0 ? 'alert' : 'healthy',
    }))
})

const title = computed(() => widgetTitle(props.widget.config.variant))
</script>

<template>
  <TechFrame
    class="status-matrix"
    variant="decoration-line"
    :title="title"
    data-widget="status-matrix"
    data-widget-type="status-matrix"
  >
    <p class="status-matrix__hint">下方格子表示关键指标健康度，颜色越亮越需要关注。</p>
    <div class="status-matrix__grid">
      <span
        v-for="cell in cells"
        :key="cell.key"
        :class="`status-matrix__cell--${cell.level}`"
        :title="`${cell.label}：${cell.value}`"
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

.status-matrix__grid span {
  display: flex;
  min-height: 36px;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  padding: 6px 8px;
  overflow: hidden;
  background: color-mix(in srgb, var(--screen-muted), transparent 72%);
  border: 1px solid var(--screen-line);
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
  background: var(--screen-signal) !important;
  box-shadow: 0 0 14px color-mix(in srgb, var(--screen-signal), transparent 55%);
}

.status-matrix__cell--alert {
  background: #ff775d !important;
}
</style>
