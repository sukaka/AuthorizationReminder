<script setup lang="ts">
import { Graph } from '@antv/g6'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import type { EffectsProfile, JsonValue, WidgetDefinition } from '../../types'
import { metricLabel, numericMetricEntries, widgetTitle } from '../../metric-labels'
import { useScreenInteraction } from '../../interactions/useScreenInteraction'

const props = defineProps<{
  widget: WidgetDefinition
  data: JsonValue
  performanceProfile: EffectsProfile
}>()

const host = ref<HTMLElement | null>(null)
const interaction = useScreenInteraction()
let graph: Graph | null = null
let observer: ResizeObserver | null = null

type GraphNodeEvent = {
  target?: {
    id?: unknown
    getID?: () => unknown
  }
  item?: {
    id?: unknown
    getID?: () => unknown
  }
}

const entries = computed(() => numericMetricEntries(props.data, 9))
const valuesByKey = computed(() => new Map(entries.value))

const nodeIdFromEvent = (event?: unknown) => {
  if (!event || typeof event !== 'object') return ''
  const payload = event as GraphNodeEvent
  return String(
    payload.target?.id
    || payload.target?.getID?.()
    || payload.item?.id
    || payload.item?.getID?.()
    || '',
  )
}

const targetForNode = (event?: unknown) => {
  const key = nodeIdFromEvent(event)
  const value = valuesByKey.value.get(key)
  if (!key || value === undefined) return null
  return interaction.targetFor(props.widget, key, value, 'graph')
}

const onNodeEnter = (event?: unknown) => {
  const target = targetForNode(event)
  if (target) interaction.hover(target)
}

const onNodeLeave = () => {
  interaction.leave()
}

const onNodeClick = (event?: unknown) => {
  const target = targetForNode(event)
  if (target) interaction.lock(target)
}

const onCanvasClick = () => {
  interaction.clear()
}

const syncGraphInteraction = () => {
  if (!graph) return
  entries.value.forEach(([key]) => {
    const relation = interaction.relationFor(key)
    const state = relation === 'primary'
      ? ['selected']
      : relation === 'related'
        ? ['active']
        : []
    graph?.setElementState(key, state)
  })
}

onMounted(async () => {
  if (!host.value) return
  const nodes = [
    { id: 'hub', data: { label: widgetTitle(props.widget.config.variant || props.widget.config.visualKey || 'core') } },
    ...entries.value.map(([key, value], index) => ({
      id: key,
      data: { label: metricLabel(key), value, metricKey: key, metricValue: value },
      style: { size: 22 + Math.min(value / 100, 28), x: 120 + (index % 3) * 180, y: 110 + Math.floor(index / 3) * 150 },
    })),
  ]
  const edges = entries.value.map(([key]) => ({ source: 'hub', target: key }))

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
  graph.on('node:pointerenter', onNodeEnter)
  graph.on('node:pointerleave', onNodeLeave)
  graph.on('node:click', onNodeClick)
  graph.on('canvas:click', onCanvasClick)
  syncGraphInteraction()
  observer = new ResizeObserver(([entry]) => {
    graph?.setSize(entry.contentRect.width, entry.contentRect.height)
  })
  observer.observe(host.value)
})

watch(() => interaction.snapshot.value, syncGraphInteraction, { deep: true })

onUnmounted(() => {
  observer?.disconnect()
  graph?.off('node:pointerenter', onNodeEnter)
  graph?.off('node:pointerleave', onNodeLeave)
  graph?.off('node:click', onNodeClick)
  graph?.off('canvas:click', onCanvasClick)
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
