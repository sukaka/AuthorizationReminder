<script setup lang="ts">
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, PolarComponent } from 'echarts/components'
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
import ParticleVeil from './ParticleVeil.vue'

const props = defineProps<{
  widget: WidgetDefinition
  data: JsonValue
  performanceProfile: EffectsProfile
}>()

use([BarChart, LineChart, GridComponent, PolarComponent, CanvasRenderer])

const host = ref<HTMLElement | null>(null)
let chart: EChartsType | null = null
let observer: ResizeObserver | null = null
let glReady = false
let entranceAnimation: { cancel?: () => void } | null = null

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
  && visualKey.value === 'threat-radar'
  && props.performanceProfile === 'high',
)

const render = async () => {
  await nextTick()
  if (!host.value) return
  if (usesGl.value && !glReady) {
    await import('echarts-gl')
    glReady = true
  }
  chart ||= init(host.value, undefined, { renderer: 'canvas' })
  const entries = numericEntries.value
  const fallback = props.widget.config.variant === 'polar-fallback'
  const option: EChartsCoreOption =
    fallback
      ? {
          animation: props.performanceProfile !== 'low',
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
            data: entries.map(([, value]) => value),
            roundCap: true,
            itemStyle: { color: '#f2b84b' },
          }],
        }
      : usesGl.value
        ? {
            animation: props.performanceProfile !== 'low',
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
              data: entries.map(([, value], index) => [index, 0, value]),
              bevelSize: 0.3,
              itemStyle: { color: '#f2b84b', opacity: 0.86 },
              shading: 'lambert',
            }],
          }
        : {
          animation: props.performanceProfile !== 'low',
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
            data: entries.map(([, value]) => value),
            lineStyle: { color: '#f2b84b', width: 3 },
            itemStyle: { color: '#b9d86b' },
            areaStyle: { color: 'rgba(242, 184, 75, .12)' },
          }],
        }
  chart.setOption(option, true)
}

watch(() => [props.data, props.performanceProfile], render, { deep: true })

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
  chart?.dispose()
})
</script>

<template>
  <section class="echart-panel" data-widget="echart" data-widget-type="echart">
    <ParticleVeil
      v-if="usesParticles"
      :id="`particles-${widget.id}`"
    />
    <div ref="host" class="echart-panel__canvas" />
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
</style>
