import type { Component } from 'vue'

import type { RegisteredWidgetType } from '../types'

type WidgetLoader = () => Promise<{ default: Component }>

const placeholder = () => import('../components/widgets/WidgetPlaceholder.vue')

export const widgetRegistry: Record<RegisteredWidgetType, WidgetLoader> = {
  'metric-cards': () => import('../components/widgets/MetricCards.vue'),
  echart: () => import('../components/widgets/EChartPanel.vue'),
  'three-scene': () => import('../components/widgets/ThreeScene.vue'),
  graph: placeholder,
  map: placeholder,
  'status-matrix': placeholder,
  'ranking-table': placeholder,
}

export const resolveWidgetLoader = (type: string) =>
  widgetRegistry[type as RegisteredWidgetType] || null
