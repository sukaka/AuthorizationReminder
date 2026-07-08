import type {
  InteractionSnapshot,
  InteractionTarget,
  JsonValue,
} from '../types'

export type InteractionRelation = 'primary' | 'related' | 'none'

const cloneTarget = (target: InteractionTarget): InteractionTarget => ({
  ...target,
  relatedKeys: [...target.relatedKeys],
  filters: { ...target.filters },
})

const metricValueFor = (
  data: JsonValue,
  key: string,
): number | string | undefined => {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return undefined
  }
  if (!Object.prototype.hasOwnProperty.call(data, key)) return undefined

  const value = data[key]
  return typeof value === 'number' || typeof value === 'string'
    ? value
    : undefined
}

export const createScreenInteractionController = (
  onChange?: (snapshot: InteractionSnapshot) => void,
) => {
  let hovered: InteractionTarget | null = null
  let locked: InteractionTarget | null = null

  const snapshot = (): InteractionSnapshot => ({
    hovered: hovered ? cloneTarget(hovered) : null,
    locked: locked ? cloneTarget(locked) : null,
  })
  const active = () => {
    const target = hovered ?? locked
    return target ? cloneTarget(target) : null
  }
  const publish = () => onChange?.(snapshot())
  const refreshTarget = (
    target: InteractionTarget | null,
    data: JsonValue,
  ): InteractionTarget | null => {
    if (!target) return null
    const value = metricValueFor(data, target.key)
    return value === undefined ? null : { ...target, value }
  }

  return {
    snapshot,
    active,
    hover(target: InteractionTarget) {
      hovered = cloneTarget(target)
      publish()
    },
    leave() {
      hovered = null
      publish()
    },
    lock(target: InteractionTarget) {
      hovered = null
      locked = cloneTarget(target)
      publish()
    },
    clear() {
      hovered = null
      locked = null
      publish()
    },
    relationFor(key: string): InteractionRelation {
      const current = active()
      if (!current) return 'none'
      if (current.key === key) return 'primary'
      return current.relatedKeys.includes(key) ? 'related' : 'none'
    },
    refresh(data: JsonValue) {
      hovered = refreshTarget(hovered, data)
      locked = refreshTarget(locked, data)
      publish()
    },
  }
}
