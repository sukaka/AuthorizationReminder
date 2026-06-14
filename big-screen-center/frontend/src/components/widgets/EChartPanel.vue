<script setup lang="ts">
import { BarChart, LineChart } from 'echarts/charts'
import {
  GridComponent,
  PolarComponent,
  TooltipComponent,
} from 'echarts/components'
import {
  init,
  use,
  type EChartsCoreOption,
  type EChartsType,
} from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { metricLabel, numericMetricEntries } from '../../metric-labels'
import type { EffectsProfile, JsonValue, WidgetDefinition } from '../../types'
import { useScreenInteraction } from '../../interactions/useScreenInteraction'
import ParticleVeil from './ParticleVeil.vue'

const props = defineProps<{
  widget: WidgetDefinition
  data: JsonValue
  performanceProfile: EffectsProfile
}>()

use([
  BarChart,
  LineChart,
  GridComponent,
  PolarComponent,
  TooltipComponent,
  CanvasRenderer,
])

const host = ref<HTMLElement | null>(null)
const glUnavailable = ref(false)
const interaction = useScreenInteraction()
let chart: EChartsType | null = null
let observer: ResizeObserver | null = null
let glReady = false
let entranceAnimation: { cancel?: () => void } | null = null
let chartEventsBound = false

type ChartEventPayload = {
  data?: {
    metricKey?: unknown
    metricValue?: unknown
    value?: unknown
  }
  name?: unknown
  value?: unknown
}

const numericEntries = computed(() => {
  return numericMetricEntries(props.data, 7)
})

const visualKey = computed(() => String(props.widget.config.visualKey || ''))
const usesGl = computed(() =>
  (visualKey.value === 'threat-radar' && props.widget.layoutArea === 'core')
  || (visualKey.value === 'capability-terrain' && props.widget.layoutArea === 'trend'),
)
const usesParticles = computed(() =>
  usesGl.value
  && !glUnavailable.value
  && visualKey.value === 'threat-radar'
  && props.performanceProfile === 'high',
)

const metricValueFromPayload = (payload: ChartEventPayload) => {
  const raw = payload.data?.metricValue ?? payload.data?.value ?? payload.value
  if (Array.isArray(raw)) return Number(raw[raw.length - 1])
  return Number(raw)
}

const metricKeyFromPayload = (payload: ChartEventPayload) =>
  String(payload.data?.metricKey || '')

const targetFromChartPayload = (payload: unknown) => {
  if (!payload || typeof payload !== 'object') return null
  const chartPayload = payload as ChartEventPayload
  const key = metricKeyFromPayload(chartPayload)
  const value = metricValueFromPayload(chartPayload)
  if (!key || !Number.isFinite(value)) return null
  return interaction.targetFor(props.widget, key, value, 'echart')
}

const onChartHover = (payload?: unknown) => {
  const target = targetFromChartPayload(payload)
  if (target) interaction.hover(target)
}

const onChartClick = (payload?: unknown) => {
  const target = targetFromChartPayload(payload)
  if (target) interaction.lock(target)
}

const onChartGlobalOut = () => {
  interaction.leave()
}

const bindChartEvents = () => {
  if (!chart || chartEventsBound) return
  chart.on('mouseover', onChartHover)
  chart.on('click', onChartClick)
  chart.on('globalout', onChartGlobalOut)
  chartEventsBound = true
}

const disposeChart = () => {
  if (chart && chartEventsBound) {
    chart.off('mouseover', onChartHover)
    chart.off('click', onChartClick)
    chart.off('globalout', onChartGlobalOut)
  }
  chart?.dispose()
  chart = null
  chartEventsBound = false
}

const syncChartInteraction = () => {
  if (!chart) return
  chart.dispatchAction({ type: 'downplay' })
  chart.dispatchAction({ type: 'hideTip' })
  numericEntries.value.forEach(([key], dataIndex) => {
    const relation = interaction.relationFor(key)
    if (relation === 'none') return
    chart?.dispatchAction({ type: 'highlight', dataIndex })
    if (relation === 'primary') {
      chart?.dispatchAction({ type: 'showTip', dataIndex })
    }
  })
}

const formatTooltip = (params: unknown) => {
  const payload = params as ChartEventPayload
  const key = metricKeyFromPayload(payload)
  const value = metricValueFromPayload(payload)
  const label = key ? metricLabel(key) : String(payload.name || '指标')
  return `${label}<br/>${Number.isFinite(value) ? value : '-'}`
}

const render = async () => {
  await nextTick()
  if (!host.value) return
  if (usesGl.value && !glReady) {
    await import('echarts-gl')
    glReady = true
  }
  chart ||= init(host.value, undefined, { renderer: 'canvas' })
  bindChartEvents()
  const entries = numericEntries.value
  const fallback = props.widget.config.variant === 'polar-fallback'
  const activeGl = usesGl.value && !glUnavailable.value
  const option: EChartsCoreOption =
    fallback
      ? {
          animation: props.performanceProfile !== 'low',
          tooltip: { trigger: 'item', formatter: formatTooltip },
          polar: { radius: ['28%', '78%'] },
          angleAxis: {
            type: 'category',
            data: entries.map(([key]) => metricLabel(key)),
            axisLabel: { color: '#c7baa4', fontSize: 10 },
          },
          radiusAxis: { axisLabel: { show: false }, splitLine: { lineStyle: { color: '#584c3d' } } },
          series: [{
            type: 'bar',
            coordinateSystem: 'polar',
            data: entries.map(([key, value]) => ({
              value,
              name: metricLabel(key),
              metricKey: key,
              metricValue: value,
            })),
            roundCap: true,
            itemStyle: { color: '#f2b84b' },
          }],
        }
      : activeGl
        ? {
            animation: props.performanceProfile !== 'low',
            tooltip: { trigger: 'item', formatter: formatTooltip },
            grid3D: {
              boxWidth: 120,
              boxDepth: 38,
              environment: '#14110d',
              viewControl: {
                autoRotate: props.performanceProfile === 'high',
                autoRotateSpeed: 3,
                distance: 150,
              },
              light: {
                main: { intensity: 1.1, shadow: false },
                ambient: { intensity: 0.55 },
              },
            },
            xAxis3D: {
              type: 'category',
              data: entries.map(([key]) => metricLabel(key)),
              axisLabel: { color: '#c7baa4' },
            },
            yAxis3D: { type: 'value', max: 1, axisLabel: { show: false } },
            zAxis3D: { type: 'value', axisLabel: { color: '#9f927d' } },
            series: [{
              type: 'bar3D',
              data: entries.map(([key, value], index) => ({
                value: [index, 0, value],
                name: metricLabel(key),
                metricKey: key,
                metricValue: value,
              })),
              bevelSize: 0.3,
              itemStyle: { color: '#f2b84b', opacity: 0.86 },
              shading: 'lambert',
            }],
          }
        : {
          animation: props.performanceProfile !== 'low',
          tooltip: { trigger: 'item', formatter: formatTooltip },
          grid: { left: 36, right: 20, top: 30, bottom: 34 },
          xAxis: {
            type: 'category',
            data: entries.map(([key]) => metricLabel(key)),
            axisLabel: { color: '#9f927d', interval: 0 },
            axisLine: { lineStyle: { color: '#584c3d' } },
          },
          yAxis: {
            type: 'value',
            axisLabel: { color: '#9f927d' },
            splitLine: { lineStyle: { color: '#332d25' } },
          },
          series: [{
            type: 'line',
            smooth: true,
            symbolSize: 8,
            data: entries.map(([key, value]) => ({
              value,
              name: metricLabel(key),
              metricKey: key,
              metricValue: value,
            })),
            lineStyle: { color: '#f2b84b', width: 3 },
            itemStyle: { color: '#b9d86b' },
            areaStyle: { color: 'rgba(242, 184, 75, .12)' },
          }],
        }
  chart.setOption(option, true)
  if (activeGl && host.value.querySelector('.ecgl-nowebgl')) {
    glUnavailable.value = true
    disposeChart()
    host.value.replaceChildren()
    await render()
    return
  }
  syncChartInteraction()
}

watch(() => [props.data, props.performanceProfile], render, { deep: true })
watch(() => interaction.snapshot.value, syncChartInteraction, { deep: true })

onMounted(() => {
  void render()
  if (
    host.value
    && ['security-route', 'growth-stairway'].includes(visualKey.value)
  ) {
    void import('animejs').then(({ animate }) => {
      if (!host.value) return
      entranceAnimation = animate(host.value, {
        opacity: [0.15, 1],
        scale: [0.97, 1],
        duration: 900,
        ease: 'out(3)',
      })
    })
  }
  observer = new ResizeObserver(() => chart?.resize())
  if (host.value) observer.observe(host.value)
})
onUnmounted(() => {
  entranceAnimation?.cancel?.()
  observer?.disconnect()
  disposeChart()
})
</script>

<template>
  <section class="echart-panel" data-widget="echart" data-widget-type="echart">
    <ParticleVeil
      v-if="usesParticles"
      :id="`particles-${widget.id}`"
    />
    <div
      ref="host"
      class="echart-panel__canvas"
      :data-gl-fallback="glUnavailable ? visualKey : undefined"
    />
  </section>
</template>

<style scoped>
.echart-panel,
.echart-panel__canvas {
  width: 100%;
  height: 100%;
  min-height: 180px;
}

.echart-panel {
  position: relative;
  overflow: hidden;
  background: linear-gradient(180deg, rgb(255 255 255 / 3%), transparent);
  border: 1px solid var(--screen-line);
}

.echart-panel__canvas {
  position: relative;
  z-index: 1;
}

.echart-panel__canvas :deep(.ecgl-nowebgl) {
  display: none;
}
</style>
