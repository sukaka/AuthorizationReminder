export type SystemKey = 'sca' | 'train-exam' | 'reminder'
export type EffectsProfile = 'high' | 'medium' | 'low'
export type LayoutKey = 'widescreen' | 'ultrawide'
export type RefreshMode = 'poll' | 'sse' | 'manual'
export type InteractionSource =
  | 'metric-card'
  | 'echart'
  | 'ranking'
  | 'status-matrix'
  | 'graph'
  | 'map'
  | 'three'
export type RegisteredWidgetType =
  | 'metric-cards'
  | 'echart'
  | 'three-scene'
  | 'graph'
  | 'map'
  | 'status-matrix'
  | 'ranking-table'

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export interface LayoutDefinition {
  width: number
  height: number
  areas: string[]
}

export interface WidgetDefinition {
  id: string
  type: RegisteredWidgetType
  dataSourceKey: string
  layoutArea: string
  optional: boolean
  minWidth: number
  minHeight: number
  maxWidth: number
  maxHeight: number
  config: Record<string, JsonValue>
}

export interface FilterDefinition {
  key: string
  type: 'date-range' | 'select' | 'multi-select'
  required: boolean
}

export interface MetricInteractionDefinition {
  key: string
  label: string
  group: string
  relatedKeys: string[]
  detailPath: string
  description: string
}

export interface InteractionTarget extends MetricInteractionDefinition {
  value?: number | string
  unit?: string
  source: InteractionSource
  sourceWidgetId: string
  templateId: string
  filters: Record<string, string | number | boolean>
}

export interface InteractionSnapshot {
  hovered: InteractionTarget | null
  locked: InteractionTarget | null
}

export interface ScreenTemplate {
  id: string
  systemKey: SystemKey
  name: string
  version: number
  themeKey: string
  effectsProfile: EffectsProfile
  layouts: Record<LayoutKey, LayoutDefinition>
  widgets: WidgetDefinition[]
  filters: FilterDefinition[]
  interactions: MetricInteractionDefinition[]
  refreshPolicy: {
    mode: RefreshMode
    intervalMs: number
  }
}

export type DataStatus = 'ok' | 'partial' | 'stale' | 'empty' | 'error'

export interface MetricEnvelope<T extends JsonValue = JsonValue> {
  schemaVersion: '1.0'
  systemKey: SystemKey
  metricKey: string
  generatedAt: string
  sourceUpdatedAt: string | null
  stale: boolean
  status: DataStatus
  data: T
  unavailableSources: string[]
}
