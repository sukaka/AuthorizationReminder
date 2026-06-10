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

import type { EffectsProfile, JsonValue, WidgetDefinition } from '../../types'

const props = defineProps<{
  widget: WidgetDefinition
  data: JsonValue
  performanceProfile: EffectsProfile
}>()

use([BarChart, LineChart, GridComponent, PolarComponent, CanvasRenderer])

const host = ref<HTMLElement | null>(null)
let chart: EChartsType | null = null
let observer: ResizeObserver | null = null

const axisLabels: Record<string, string> = {
  totalProjects: '项目',
  criticalRisks: '严重',
  vulnerableComponents: '组件',
  healthyRate: '健康',
  activeCourses: '课程',
  learners: '学员',
  completionRate: '完成',
  certificates: '证书',
  expiring7d: '7天',
  expiring30d: '30天',
  riskAmount: '金额',
  deliveryRate: '触达',
  mandatory: '必修',
  elective: '选修',
  overdue: '逾期',
  high: '高危',
  medium: '中危',
  low: '低危',
  day7: '7天',
  day30: '30天',
  day60: '60天',
  day90: '90天',
}

const numericEntries = computed(() => {
  if (!props.data || typeof props.data !== 'object' || Array.isArray(props.data)) return []
  return Object.entries(props.data)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .slice(0, 7)
})

const render = async () => {
  await nextTick()
  if (!host.value) return
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
            data: entries.map(([key]) => axisLabels[key] || key),
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
      : {
          animation: props.performanceProfile !== 'low',
          grid: { left: 36, right: 20, top: 30, bottom: 34 },
          xAxis: {
            type: 'category',
            data: entries.map(([key]) => axisLabels[key] || key),
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
  observer = new ResizeObserver(() => chart?.resize())
  if (host.value) observer.observe(host.value)
})
onUnmounted(() => {
  observer?.disconnect()
  chart?.dispose()
})
</script>

<template>
  <section class="echart-panel" data-widget="echart" data-widget-type="echart">
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
  background: linear-gradient(180deg, rgb(255 255 255 / 3%), transparent);
  border: 1px solid var(--screen-line);
}
</style>
