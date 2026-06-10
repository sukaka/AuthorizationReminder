export type SystemKey = 'sca' | 'train-exam' | 'reminder'
export type EffectsProfile = 'high' | 'medium' | 'low'
export type LayoutKey = 'widescreen' | 'ultrawide'
export type RefreshMode = 'poll' | 'sse' | 'manual'
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
  refreshPolicy: {
    mode: RefreshMode
    intervalMs: number
  }
}
