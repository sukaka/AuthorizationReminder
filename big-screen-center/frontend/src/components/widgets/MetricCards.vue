<script setup lang="ts">
import { computed } from 'vue'

import { useScreenInteraction } from '../../interactions/useScreenInteraction'
import { metricLabel, numericMetricEntries } from '../../metric-labels'
import type { EffectsProfile, InteractionSource, JsonValue, WidgetDefinition } from '../../types'

const props = defineProps<{
  widget: WidgetDefinition
  data: JsonValue
  performanceProfile: EffectsProfile
}>()
const interaction = useScreenInteraction()

const cards = computed(() => {
  return numericMetricEntries(props.data, 4)
    .map(([key, value]) => ({
      key,
      label: metricLabel(key),
      value,
      suffix: key.toLowerCase().includes('rate') ? '%' : '',
    }))
})

const source: InteractionSource = 'metric-card'
const preview = (key: string, value: number) =>
  interaction.hover(interaction.targetFor(props.widget, key, value, source))
const select = (key: string, value: number) =>
  interaction.lock(interaction.targetFor(props.widget, key, value, source))
const relation = (key: string) => interaction.relationFor(key)
const pressed = (key: string) => interaction.snapshot.value.locked?.key === key
</script>

<template>
  <section
    class="metric-cards"
    data-widget="metric-cards"
    data-widget-type="metric-cards"
    data-theme-surface="bright"
  >
    <article
      v-for="card in cards"
      :key="card.key"
      role="button"
      tabindex="0"
      :data-interaction-key="card.key"
      :data-interaction-state="relation(card.key)"
      :data-performance-profile="performanceProfile"
      :aria-pressed="pressed(card.key)"
      :aria-label="`${card.label}：${card.value}`"
      @mouseenter="preview(card.key, card.value)"
      @mouseleave="interaction.leave()"
      @click.stop="select(card.key, card.value)"
      @keydown.enter.prevent="select(card.key, card.value)"
      @keydown.space.prevent="select(card.key, card.value)"
    >
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
  background: var(--screen-surface);
  border: 1px solid var(--screen-line);
  box-shadow: 0 10px 28px var(--screen-shadow);
  transition:
    border-color 180ms ease,
    box-shadow 180ms ease,
    transform 180ms ease;
  cursor: pointer;
}

article:focus-visible {
  outline: 2px solid var(--screen-accent);
  outline-offset: 3px;
}

article[data-interaction-state="primary"] {
  border-color: var(--screen-accent);
  box-shadow: 0 16px 34px color-mix(in srgb, var(--screen-accent), transparent 87%);
  transform: translateY(-3px);
}

article[data-interaction-state="related"] {
  border-color: color-mix(in srgb, var(--screen-accent), transparent 32%);
}

article[data-performance-profile="low"] {
  box-shadow: none;
  transform: none;
}

span {
  color: var(--screen-muted);
  font-size: 15px;
  letter-spacing: 0.12em;
}

strong {
  display: block;
  margin-top: 12px;
  color: var(--screen-text);
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
  background: linear-gradient(90deg, var(--screen-accent), var(--screen-accent-secondary));
  box-shadow: none;
}

@media (prefers-reduced-motion: reduce) {
  article {
    transform: none !important;
  }
}
</style>
