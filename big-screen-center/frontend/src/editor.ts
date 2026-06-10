import type {
  EffectsProfile,
  JsonValue,
  LayoutKey,
  ScreenTemplate,
} from './types'

export interface WidgetLayoutEdit {
  area: string
  x: number
  y: number
  width: number
  height: number
}

export interface WidgetEditorState {
  hidden: boolean
  layouts: Record<LayoutKey, WidgetLayoutEdit>
}

export interface EditorState {
  themeKey: string
  effectsProfile: EffectsProfile
  filters: Record<string, string | string[]>
  widgets: Record<string, WidgetEditorState>
}

export type EditorCommand =
  | { type: 'set-hidden'; widgetId: string; hidden: boolean }
  | {
      type: 'set-position'
      widgetId: string
      layout: LayoutKey
      area: string
      x: number
      y: number
    }
  | {
      type: 'set-size'
      widgetId: string
      layout: LayoutKey
      width: number
      height: number
    }
  | { type: 'set-filter'; key: string; value: string | string[] }
  | { type: 'set-theme'; themeKey: string }
  | { type: 'set-effects'; profile: EffectsProfile }

const cloneState = (state: EditorState): EditorState =>
  structuredClone(state)

const findWidget = (template: ScreenTemplate, widgetId: string) => {
  const widget = template.widgets.find((candidate) => candidate.id === widgetId)
  if (!widget) throw new Error('Widget does not exist')
  return widget
}

export const createEditorState = (template: ScreenTemplate): EditorState => ({
  themeKey: template.themeKey,
  effectsProfile: template.effectsProfile,
  filters: {},
  widgets: Object.fromEntries(template.widgets.map((widget, index) => [
    widget.id,
    {
      hidden: false,
      layouts: {
        widescreen: {
          area: widget.layoutArea,
          x: (index % 3) * 4,
          y: Math.floor(index / 3) * 3,
          width: Math.min(Math.max(widget.minWidth, 4), widget.maxWidth),
          height: Math.min(Math.max(widget.minHeight, 3), widget.maxHeight),
        },
        ultrawide: {
          area: widget.layoutArea,
          x: (index % 3) * 8,
          y: Math.floor(index / 3) * 3,
          width: Math.min(Math.max(widget.minWidth, 6), widget.maxWidth),
          height: Math.min(Math.max(widget.minHeight, 3), widget.maxHeight),
        },
      },
    },
  ])),
})

export const applyEdit = (
  template: ScreenTemplate,
  state: EditorState,
  command: EditorCommand,
): EditorState => {
  const next = cloneState(state)

  if (command.type === 'set-theme') {
    if (!/^[a-z0-9-]{1,64}$/i.test(command.themeKey)) {
      throw new Error('Theme key is invalid')
    }
    next.themeKey = command.themeKey
    return next
  }
  if (command.type === 'set-effects') {
    next.effectsProfile = command.profile
    return next
  }
  if (command.type === 'set-filter') {
    if (!template.filters.some((filter) => filter.key === command.key)) {
      throw new Error('Filter is not declared by template')
    }
    next.filters[command.key] = command.value
    return next
  }

  const widget = findWidget(template, command.widgetId)
  const widgetState = next.widgets[widget.id]
  if (!widgetState) throw new Error('Widget editor state is missing')

  if (command.type === 'set-hidden') {
    if (command.hidden && !widget.optional) {
      throw new Error('Required widget cannot be hidden')
    }
    widgetState.hidden = command.hidden
    return next
  }

  if (command.type === 'set-position') {
    if (!template.layouts[command.layout].areas.includes(command.area)) {
      throw new Error('Layout area is not allowed')
    }
    if (
      !Number.isInteger(command.x)
      || !Number.isInteger(command.y)
      || command.x < 0
      || command.y < 0
    ) {
      throw new Error('Widget position is invalid')
    }
    Object.assign(widgetState.layouts[command.layout], {
      area: command.area,
      x: command.x,
      y: command.y,
    })
    return next
  }

  if (
    command.width < widget.minWidth
    || command.width > widget.maxWidth
    || command.height < widget.minHeight
    || command.height > widget.maxHeight
  ) {
    throw new Error('Widget size is outside allowed bounds')
  }
  Object.assign(widgetState.layouts[command.layout], {
    width: command.width,
    height: command.height,
  })
  return next
}

export const serializeEditorState = (state: EditorState): JsonValue =>
  structuredClone(state) as unknown as JsonValue
