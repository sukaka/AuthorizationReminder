<script setup lang="ts">
import { computed } from 'vue'

import { useScreenInteraction } from '../../interactions/useScreenInteraction'
import { metricLabel, numericMetricEntries, widgetTitle } from '../../metric-labels'
import type { EffectsProfile, InteractionSource, JsonValue, WidgetDefinition } from '../../types'
import TechFrame from './TechFrame.vue'

const props = defineProps<{
  widget: WidgetDefinition
  data: JsonValue
  performanceProfile: EffectsProfile
}>()
const interaction = useScreenInteraction()

const rows = computed(() => {
  return numericMetricEntries(props.data, 30)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([key, value]) => ({
      key,
      label: metricLabel(key),
      value,
    }))
})

const maximum = computed(() => Math.max(...rows.value.map((row) => row.value), 1))
const title = computed(() => widgetTitle(props.widget.config.variant))
const source: InteractionSource = 'ranking'
const preview = (key: string, value: number) =>
  interaction.hover(interaction.targetFor(props.widget, key, value, source))
const select = (key: string, value: number) =>
  interaction.lock(interaction.targetFor(props.widget, key, value, source))
const relation = (key: string) => interaction.relationFor(key)
const pressed = (key: string) => interaction.snapshot.value.locked?.key === key
</script>

<template>
  <TechFrame
    class="ranking-table"
    variant="border-box"
    data-widget="ranking-table"
    data-widget-type="ranking-table"
  >
    <div class="ranking-table__content">
      <header>
        <span>排行 / {{ title }}</span>
        <strong>前 {{ rows.length }} 项</strong>
      </header>
      <ol>
        <li
          v-for="(row, index) in rows"
          :key="row.key"
          role="button"
          tabindex="0"
          :data-interaction-key="row.key"
          :data-interaction-state="relation(row.key)"
          :data-performance-profile="performanceProfile"
          :aria-pressed="pressed(row.key)"
          :aria-label="`${row.label}：${row.value}`"
          @mouseenter="preview(row.key, row.value)"
          @mouseleave="interaction.leave()"
          @click.stop="select(row.key, row.value)"
          @keydown.enter.prevent="select(row.key, row.value)"
          @keydown.space.prevent="select(row.key, row.value)"
        >
          <b>{{ String(index + 1).padStart(2, '0') }}</b>
          <div>
            <span>{{ row.label }}</span>
            <i :style="{ width: `${(row.value / maximum) * 100}%` }" />
          </div>
          <strong>{{ row.value.toLocaleString() }}</strong>
        </li>
      </ol>
    </div>
  </TechFrame>
</template>

<style scoped>
.ranking-table__content {
  height: 100%;
  padding: 30px 28px;
}

header,
li {
  display: grid;
  align-items: center;
}

header {
  grid-template-columns: 1fr auto;
  padding-bottom: 22px;
  color: var(--screen-muted);
  border-bottom: 1px solid var(--screen-line);
  font-size: 10px;
  letter-spacing: 0.17em;
}

ol {
  display: grid;
  gap: 20px;
  margin: 24px 0 0;
  padding: 0;
  list-style: none;
}

li {
  grid-template-columns: 32px minmax(0, 1fr) auto;
  gap: 14px;
  padding: 4px 0;
  border: 1px solid transparent;
  cursor: pointer;
  transition:
    border-color 180ms ease,
    background-color 180ms ease,
    transform 180ms ease;
}

li:focus-visible {
  outline: 2px solid var(--screen-accent);
  outline-offset: 3px;
}

li[data-interaction-state="primary"] {
  border-color: var(--screen-accent);
  background: color-mix(in srgb, var(--screen-accent), transparent 88%);
  transform: translateX(4px);
}

li[data-interaction-state="related"] {
  border-color: color-mix(in srgb, var(--screen-accent), transparent 45%);
}

li[data-performance-profile="low"] {
  transform: none;
}

li b {
  color: var(--screen-accent);
  font-family: var(--font-display);
  font-size: 18px;
}

li div {
  min-width: 0;
}

li span {
  display: block;
  overflow: hidden;
  color: var(--screen-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

li i {
  display: block;
  height: 2px;
  margin-top: 7px;
  background: var(--screen-accent);
}

li strong {
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 500;
}
</style>
