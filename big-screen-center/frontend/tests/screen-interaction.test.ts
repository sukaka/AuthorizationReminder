import { describe, expect, it } from 'vitest'

import { createScreenInteractionController } from '../src/interactions/screen-interaction'
import type {
  InteractionSnapshot,
  InteractionTarget,
  JsonValue,
} from '../src/types'

const target = (
  key: string,
  value: number | string,
  relatedKeys: string[] = [],
): InteractionTarget => ({
  key,
  label: key,
  group: 'summary',
  relatedKeys,
  detailPath: '/',
  description: `${key} description`,
  value,
  source: 'metric-card',
  sourceWidgetId: 'summary-cards',
  templateId: 'sca-overview',
  filters: {},
})

describe('screen interaction controller', () => {
  it('uses hover temporarily and returns to the default state on leave', () => {
    const controller = createScreenInteractionController()
    const hovered = target('risks', 12)

    expect(controller.snapshot()).toEqual({ hovered: null, locked: null })
    controller.hover(hovered)
    expect(controller.active()).toEqual(hovered)

    controller.leave()

    expect(controller.active()).toBeNull()
    expect(controller.snapshot()).toEqual({ hovered: null, locked: null })
  })

  it('restores a locked target after a temporary hover leaves', () => {
    const controller = createScreenInteractionController()
    const locked = target('risks', 12)
    const hovered = target('licenses', 8)

    controller.lock(locked)
    controller.hover(hovered)
    expect(controller.active()).toEqual(hovered)

    controller.leave()

    expect(controller.active()).toEqual(locked)
    expect(controller.snapshot()).toEqual({ hovered: null, locked })
  })

  it('switches locks and keeps the same target locked on repeated selection', () => {
    const controller = createScreenInteractionController()
    const first = target('risks', 12)
    const second = target('licenses', 8)

    controller.lock(first)
    controller.lock(second)
    controller.lock(second)

    expect(controller.active()).toEqual(second)
    expect(controller.snapshot()).toEqual({ hovered: null, locked: second })
  })

  it('clears an active hover when locking another target', () => {
    const controller = createScreenInteractionController()
    const first = target('risks', 12)
    const hovered = target('licenses', 8)
    const next = target('critical-risks', 3)

    controller.lock(first)
    controller.hover(hovered)
    controller.lock(next)

    expect(controller.snapshot()).toEqual({ hovered: null, locked: next })
    expect(controller.active()).toEqual(next)
  })

  it('classifies only the active and explicitly related metrics', () => {
    const controller = createScreenInteractionController()
    controller.lock(target('risks', 12, ['critical-risks', 'licenses']))

    expect(controller.relationFor('risks')).toBe('primary')
    expect(controller.relationFor('critical-risks')).toBe('related')
    expect(controller.relationFor('unrelated-widget')).toBe('none')

    controller.clear()
    expect(controller.relationFor('risks')).toBe('none')
  })

  it('clears hover and lock state together', () => {
    const controller = createScreenInteractionController()
    controller.lock(target('risks', 12))
    controller.hover(target('licenses', 8))

    controller.clear()

    expect(controller.active()).toBeNull()
    expect(controller.snapshot()).toEqual({ hovered: null, locked: null })
  })

  it('refreshes existing hovered and locked number or string values', () => {
    const controller = createScreenInteractionController()
    const locked = target('risks', 12)
    const hovered = target('licenses', 8)

    controller.lock(locked)
    controller.hover(hovered)
    controller.refresh({ risks: '14 项', licenses: 9 })

    expect(controller.snapshot()).toEqual({
      hovered: { ...hovered, value: 9 },
      locked: { ...locked, value: '14 项' },
    })
    expect(controller.active()).toEqual({ ...hovered, value: 9 })
  })

  it('updates and preserves a hover-only target when its key remains', () => {
    const controller = createScreenInteractionController()
    const hovered = target('licenses', 8)

    controller.hover(hovered)
    controller.refresh({ licenses: '9 项' })

    expect(controller.snapshot()).toEqual({
      hovered: { ...hovered, value: '9 项' },
      locked: null,
    })
  })

  it('clears a missing hover and falls back to a refreshed lock', () => {
    const controller = createScreenInteractionController()
    const locked = target('risks', 12)

    controller.lock(locked)
    controller.hover(target('licenses', 8))
    controller.refresh({ risks: 14 })

    expect(controller.snapshot()).toEqual({
      hovered: null,
      locked: { ...locked, value: 14 },
    })
    expect(controller.active()).toEqual({ ...locked, value: 14 })
  })

  it('clears targets whose metrics are missing or not number or string', () => {
    const invalidValues: JsonValue[] = [{}, [], null, true]

    for (const invalidValue of invalidValues) {
      const controller = createScreenInteractionController()
      controller.lock(target('risks', 12))
      controller.hover(target('licenses', 8))

      controller.refresh({
        risks: invalidValue,
        licenses: invalidValue,
      })

      expect(controller.snapshot()).toEqual({ hovered: null, locked: null })
    }
  })

  it('safely clears state for non-object refresh payloads', () => {
    const payloads: JsonValue[] = [null, [], 'payload']

    for (const payload of payloads) {
      const controller = createScreenInteractionController()
      controller.lock(target('risks', 12))
      controller.hover(target('licenses', 8))

      expect(() => controller.refresh(payload)).not.toThrow()
      expect(controller.snapshot()).toEqual({ hovered: null, locked: null })
    }
  })

  it('clones accepted targets and returned snapshots deeply enough for state', () => {
    const controller = createScreenInteractionController()
    const hovered = target('risks', 12, ['licenses'])
    hovered.filters.region = 'north'

    controller.hover(hovered)
    hovered.key = 'mutated-input'
    hovered.relatedKeys.push('mutated-input-related')
    hovered.filters.region = 'mutated-input-filter'

    const snapshot = controller.snapshot()
    snapshot.hovered!.key = 'mutated-snapshot'
    snapshot.hovered!.relatedKeys.push('mutated-snapshot-related')
    snapshot.hovered!.filters.region = 'mutated-snapshot-filter'
    snapshot.hovered = null

    expect(controller.snapshot().hovered).toMatchObject({
      key: 'risks',
      relatedKeys: ['licenses'],
      filters: { region: 'north' },
    })
  })

  it('publishes independent snapshots with isolated nested target state', () => {
    const changes: InteractionSnapshot[] = []
    const publishedTargets: InteractionTarget[] = []
    const controller = createScreenInteractionController((snapshot) => {
      changes.push(snapshot)
      const published = snapshot.hovered ?? snapshot.locked
      if (published) {
        publishedTargets.push(published)
        published.key = 'mutated-change'
        published.relatedKeys.push('mutated-change-related')
        published.filters.region = 'mutated-change-filter'
      }
      snapshot.hovered = null
      snapshot.locked = null
    })
    const hovered = target('risks', 12, ['licenses'])
    hovered.filters.region = 'north'

    controller.hover(hovered)
    controller.refresh({ risks: 14 })

    expect(changes).toHaveLength(2)
    expect(new Set(changes).size).toBe(2)
    expect(publishedTargets).toHaveLength(2)
    expect(publishedTargets[0]).not.toBe(publishedTargets[1])
    expect(publishedTargets[0]?.relatedKeys)
      .not.toBe(publishedTargets[1]?.relatedKeys)
    expect(publishedTargets[0]?.filters).not.toBe(publishedTargets[1]?.filters)
    expect(controller.snapshot().hovered).toMatchObject({
      key: 'risks',
      value: 14,
      relatedKeys: ['licenses'],
      filters: { region: 'north' },
    })
  })
})
