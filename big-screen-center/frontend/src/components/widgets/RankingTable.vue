<script setup lang="ts">
import { computed } from 'vue'

import type { EffectsProfile, JsonValue, WidgetDefinition } from '../../types'
import TechFrame from './TechFrame.vue'

const props = defineProps<{
  widget: WidgetDefinition
  data: JsonValue
  performanceProfile: EffectsProfile
}>()

const rows = computed(() => {
  if (!props.data || typeof props.data !== 'object' || Array.isArray(props.data)) return []
  return Object.entries(props.data)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
})

const maximum = computed(() => Math.max(...rows.value.map((row) => row[1]), 1))
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
        <span>RANK / {{ widget.config.variant }}</span>
        <strong>TOP {{ rows.length }}</strong>
      </header>
      <ol>
        <li v-for="([key, value], index) in rows" :key="key">
          <b>{{ String(index + 1).padStart(2, '0') }}</b>
          <div>
            <span>{{ key }}</span>
            <i :style="{ width: `${(value / maximum) * 100}%` }" />
          </div>
          <strong>{{ value.toLocaleString() }}</strong>
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
