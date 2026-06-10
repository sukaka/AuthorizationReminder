<script setup lang="ts">
import { computed } from 'vue'

import type { EffectsProfile, JsonValue, WidgetDefinition } from '../../types'
import TechFrame from './TechFrame.vue'

const props = defineProps<{
  widget: WidgetDefinition
  data: JsonValue
  performanceProfile: EffectsProfile
}>()

const cells = computed(() => {
  if (!props.data || typeof props.data !== 'object' || Array.isArray(props.data)) return []
  return Object.entries(props.data)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .slice(0, 12)
    .map(([key, value], index) => ({
      key,
      value,
      level: value === 0 ? 'idle' : index % 5 === 0 ? 'alert' : 'healthy',
    }))
})
</script>

<template>
  <TechFrame
    class="status-matrix"
    variant="decoration-line"
    :title="String(widget.config.variant)"
    data-widget="status-matrix"
    data-widget-type="status-matrix"
  >
    <div class="status-matrix__grid">
      <span
        v-for="cell in cells"
        :key="cell.key"
        :class="`status-matrix__cell--${cell.level}`"
        :title="`${cell.key}: ${cell.value}`"
      />
    </div>
  </TechFrame>
</template>

<style scoped>
.status-matrix__grid {
  display: grid;
  grid-template-columns: repeat(12, minmax(8px, 1fr));
  gap: 7px;
  margin-top: 18px;
}

.status-matrix__grid span {
  height: 30px;
  background: color-mix(in srgb, var(--screen-muted), transparent 72%);
  border: 1px solid var(--screen-line);
}

.status-matrix__cell--healthy {
  background: var(--screen-signal) !important;
  box-shadow: 0 0 14px color-mix(in srgb, var(--screen-signal), transparent 55%);
}

.status-matrix__cell--alert {
  background: #ff775d !important;
}
</style>
