<script setup lang="ts">
import { computed } from 'vue'

import type { DataStatus } from '../types'

const props = defineProps<{
  status: DataStatus | 'mock' | 'loading'
  generatedAt: string | null
  stale: boolean
  unavailableSources: string[]
}>()

const visibleStatus = computed(() => props.stale ? 'stale' : props.status)
const statusLabel = computed(() => ({
  empty: '无数据',
  error: '异常',
  loading: '加载中',
  mock: '演示',
  ok: '正常',
  partial: '部分可用',
  stale: '已过期',
})[visibleStatus.value] || '未知')

const sourceLabels: Record<string, string> = {
  sca: '软件成分分析',
  'train-exam': '培训考试',
  reminder: '授权提醒',
  overview: '总览接口',
  assets: '资产接口',
  dependencyCheck: 'Dependency-Check',
  devops: 'DevOps接口',
  passTrend: '考试通过趋势',
  organization: '组织统计',
  dashboard: '提醒看板',
  salesOverview: '销售授权总览',
}

const unavailableSourceNames = computed(() =>
  props.unavailableSources.map((source) => sourceLabels[source] || source),
)

const unavailableSourceText = computed(() =>
  unavailableSourceNames.value.join('、'),
)

const formatTime = (value: string | null) => {
  if (!value) return '等待数据'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? '时间未知'
    : parsed.toLocaleTimeString('zh-CN', { hour12: false })
}
</script>

<template>
  <div class="source-health" :data-source-status="visibleStatus">
    <span :class="`source-health__dot source-health__dot--${visibleStatus}`" />
    <div>
      <strong>{{ statusLabel }}</strong>
      <small>生成 {{ formatTime(generatedAt) }}</small>
    </div>
    <em
      v-if="unavailableSources.length"
      :title="unavailableSourceText"
    >
      {{ unavailableSources.length }} 个来源不可用：{{ unavailableSourceText }}
    </em>
  </div>
</template>

<style scoped>
.source-health {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 9px;
}

.source-health__dot {
  width: 7px;
  height: 7px;
  background: #9b8f7c;
  border-radius: 50%;
}

.source-health__dot--ok,
.source-health__dot--mock {
  background: var(--screen-signal);
  box-shadow: 0 0 12px var(--screen-signal);
}

.source-health__dot--partial,
.source-health__dot--stale {
  background: var(--screen-accent);
}

.source-health__dot--error {
  background: #ff775d;
  box-shadow: 0 0 12px #ff775d;
}

.source-health strong,
.source-health small {
  display: block;
}

.source-health strong {
  color: #f4ead7;
  font-size: 10px;
  letter-spacing: 0.16em;
}

.source-health small,
.source-health em {
  margin-top: 3px;
  color: var(--screen-muted);
  font-size: 9px;
  font-style: normal;
}
</style>
