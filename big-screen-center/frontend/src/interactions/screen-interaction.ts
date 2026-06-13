import type {
  InteractionSnapshot,
  InteractionTarget,
  JsonValue,
} from '../types'

export type InteractionRelation = 'primary' | 'related' | 'none'

export const createScreenInteractionController = (
  onChange?: (snapshot: InteractionSnapshot) => void,
) => {
  let hovered: InteractionTarget | null = null
  let locked: InteractionTarget | null = null

  const snapshot = (): InteractionSnapshot => ({ hovered, locked })
  const active = () => hovered ?? locked
  const publish = () => onChange?.(snapshot())

  return {
    snapshot,
    active,
    hover(target: InteractionTarget) {
      hovered = target
      publish()
    },
    leave() {
      hovered = null
      publish()
    },
    lock(target: InteractionTarget) {
      hovered = null
      locked = target
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
    refresh(data: Record<string, JsonValue>) {
      hovered = null
      if (locked) {
        const value = data[locked.key]
        if (
          Object.prototype.hasOwnProperty.call(data, locked.key)
          && (typeof value === 'number' || typeof value === 'string')
        ) {
          locked = { ...locked, value }
        } else {
          locked = null
        }
      }
      publish()
    },
  }
}
