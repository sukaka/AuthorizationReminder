<script setup lang="ts">
import { Graph } from '@antv/g6'
import { onMounted, onUnmounted, ref } from 'vue'

import type { EffectsProfile, JsonValue, WidgetDefinition } from '../../types'
import { metricLabel, numericMetricEntries, widgetTitle } from '../../metric-labels'

const props = defineProps<{
  widget: WidgetDefinition
  data: JsonValue
  performanceProfile: EffectsProfile
}>()

const host = ref<HTMLElement | null>(null)
let graph: Graph | null = null
let observer: ResizeObserver | null = null

onMounted(async () => {
  if (!host.value) return
  const entries = numericMetricEntries(props.data, 9)
  const nodes = [
    { id: 'hub', data: { label: widgetTitle(props.widget.config.variant || props.widget.config.visualKey || 'core') } },
    ...entries.map(([key, value], index) => ({
      id: key,
      data: { label: metricLabel(key), value },
      style: { size: 22 + Math.min(value / 100, 28), x: 120 + (index % 3) * 180, y: 110 + Math.floor(index / 3) * 150 },
    })),
  ]
  const edges = entries.map(([key]) => ({ source: 'hub', target: key }))

  graph = new Graph({
    container: host.value,
    data: { nodes, edges },
    animation: props.performanceProfile === 'high',
    layout: { type: 'force', preventOverlap: true, linkDistance: 120 },
    node: {
      style: {
        fill: '#201b14',
        stroke: '#f2b84b',
        lineWidth: 2,
        labelText: (datum) => String(datum.data?.label || datum.id),
        labelFill: '#d9ccb5',
        labelFontSize: 11,
        labelPlacement: 'bottom',
      },
    },
    edge: {
      style: {
        stroke: '#756348',
        lineWidth: 1,
        endArrow: true,
      },
    },
  })
  await graph.render()
  observer = new ResizeObserver(([entry]) => {
    graph?.setSize(entry.contentRect.width, entry.contentRect.height)
  })
  observer.observe(host.value)
})

onUnmounted(() => {
  observer?.disconnect()
  graph?.destroy()
})
</script>

<template>
  <section class="graph-panel" data-widget="graph" data-widget-type="graph">
    <div ref="host" class="graph-panel__canvas" />
    <span>{{ widgetTitle(widget.config.variant) }}</span>
  </section>
</template>

<style scoped>
.graph-panel,
.graph-panel__canvas {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
}

.graph-panel {
  overflow: hidden;
  background: radial-gradient(circle, rgb(242 184 75 / 9%), transparent 62%);
  border: 1px solid var(--screen-line);
}

.graph-panel > span {
  position: absolute;
  left: 24px;
  bottom: 20px;
  color: var(--screen-muted);
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}
</style>
