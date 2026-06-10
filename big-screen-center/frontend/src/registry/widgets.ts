import type { Component } from 'vue'

import type { RegisteredWidgetType } from '../types'

type WidgetLoader = () => Promise<{ default: Component }>

export const widgetRegistry: Record<RegisteredWidgetType, WidgetLoader> = {
  'metric-cards': () => import('../components/widgets/MetricCards.vue'),
  echart: () => import('../components/widgets/EChartPanel.vue'),
  'three-scene': () => import('../components/widgets/ThreeScene.vue'),
  graph: () => import('../components/widgets/GraphPanel.vue'),
  map: () => import('../components/widgets/MapPanel.vue'),
  'status-matrix': () => import('../components/widgets/StatusMatrix.vue'),
  'ranking-table': () => import('../components/widgets/RankingTable.vue'),
}

export const resolveWidgetLoader = (type: string) =>
  widgetRegistry[type as RegisteredWidgetType] || null
