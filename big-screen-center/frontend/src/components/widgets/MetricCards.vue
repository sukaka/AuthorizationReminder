<script setup lang="ts">
import { computed } from 'vue'

import { metricLabel, numericMetricEntries } from '../../metric-labels'
import type { EffectsProfile, JsonValue, WidgetDefinition } from '../../types'

const props = defineProps<{
  widget: WidgetDefinition
  data: JsonValue
  performanceProfile: EffectsProfile
}>()

const cards = computed(() => {
  return numericMetricEntries(props.data, 4)
    .map(([key, value]) => ({
      key,
      label: metricLabel(key),
      value,
      suffix: key.toLowerCase().includes('rate') ? '%' : '',
    }))
})
</script>

<template>
  <section
    class="metric-cards"
    data-widget="metric-cards"
    data-widget-type="metric-cards"
  >
    <article v-for="card in cards" :key="card.key">
      <span>{{ card.label }}</span>
      <strong>{{ card.value.toLocaleString() }}<small>{{ card.suffix }}</small></strong>
      <i aria-hidden="true" />
    </article>
  </section>
</template>

<style scoped>
.metric-cards {
  height: 100%;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 18px;
}

article {
  position: relative;
  min-width: 0;
  padding: 22px 24px;
  overflow: hidden;
  background: linear-gradient(135deg, rgb(255 255 255 / 5%), transparent 62%);
  border: 1px solid var(--screen-line);
}

span {
  color: var(--screen-muted);
  font-size: 15px;
  letter-spacing: 0.12em;
}

strong {
  display: block;
  margin-top: 12px;
  font-family: var(--font-display);
  font-size: 46px;
  font-weight: 500;
}

small {
  margin-left: 4px;
  color: var(--screen-accent);
  font-size: 17px;
}

i {
  position: absolute;
  right: 18px;
  bottom: 18px;
  width: 54px;
  height: 2px;
  background: var(--screen-accent);
  box-shadow: 0 0 18px var(--screen-accent);
}
</style>
