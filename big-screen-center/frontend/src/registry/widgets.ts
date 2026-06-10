import type { Component } from 'vue'

import type { RegisteredWidgetType } from '../types'

type WidgetLoader = () => Promise<{ default: Component }>

const placeholder = () => import('../components/widgets/WidgetPlaceholder.vue')

export const widgetRegistry: Record<RegisteredWidgetType, WidgetLoader> = {
  'metric-cards': placeholder,
  echart: placeholder,
  'three-scene': placeholder,
  graph: placeholder,
  map: placeholder,
  'status-matrix': placeholder,
  'ranking-table': placeholder,
}

export const resolveWidgetLoader = (type: string) =>
  widgetRegistry[type as RegisteredWidgetType] || null
