<script setup lang="ts">
import { computed } from 'vue'

import type { EffectsProfile, JsonValue, WidgetDefinition } from '../../types'

const props = defineProps<{
  widget: WidgetDefinition
  data: JsonValue
  performanceProfile: EffectsProfile
}>()

const labels: Record<string, string> = {
  totalProjects: '项目总量',
  criticalRisks: '严重风险',
  vulnerableComponents: '风险组件',
  healthyRate: '健康率',
  activeCourses: '进行中课程',
  learners: '参训人数',
  completionRate: '完成率',
  certificates: '证书签发',
  expiring7d: '7 天到期',
  expiring30d: '30 天到期',
  riskAmount: '风险金额',
  deliveryRate: '提醒触达率',
}

const cards = computed(() => {
  if (!props.data || typeof props.data !== 'object' || Array.isArray(props.data)) return []
  return Object.entries(props.data)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .slice(0, 4)
    .map(([key, value]) => ({
      key,
      label: labels[key] || key.replace(/([A-Z])/g, ' $1').trim(),
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
