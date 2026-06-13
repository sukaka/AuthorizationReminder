import { describe, expect, it } from 'vitest'

import { createScreenInteractionController } from '../src/interactions/screen-interaction'
import type { InteractionSnapshot, InteractionTarget } from '../src/types'

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
    expect(controller.active()).toBe(hovered)

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
    expect(controller.active()).toBe(hovered)

    controller.leave()

    expect(controller.active()).toBe(locked)
    expect(controller.snapshot()).toEqual({ hovered: null, locked })
  })

  it('switches locks and keeps the same target locked on repeated selection', () => {
    const controller = createScreenInteractionController()
    const first = target('risks', 12)
    const second = target('licenses', 8)

    controller.lock(first)
    controller.lock(second)
    controller.lock(second)

    expect(controller.active()).toBe(second)
    expect(controller.snapshot()).toEqual({ hovered: null, locked: second })
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

  it('refreshes locked number and string values while clearing hover', () => {
    const controller = createScreenInteractionController()
    const locked = target('risks', 12)
    controller.lock(locked)
    controller.hover(target('licenses', 8))

    controller.refresh({ risks: 14, licenses: 9 })
    expect(controller.snapshot()).toEqual({
      hovered: null,
      locked: { ...locked, value: 14 },
    })

    controller.refresh({ risks: '14 项' })
    expect(controller.snapshot().locked?.value).toBe('14 项')
  })

  it('clears invalid locks and clears hover even without a lock', () => {
    const invalidValues = [
      {},
      [],
    ]

    for (const invalidValue of invalidValues) {
      const controller = createScreenInteractionController()
      controller.lock(target('risks', 12))
      controller.hover(target('licenses', 8))

      controller.refresh({ risks: invalidValue })

      expect(controller.snapshot()).toEqual({ hovered: null, locked: null })
    }

    const missing = createScreenInteractionController()
    missing.lock(target('risks', 12))
    missing.refresh({ licenses: 9 })
    expect(missing.snapshot()).toEqual({ hovered: null, locked: null })

    const hoverOnly = createScreenInteractionController()
    hoverOnly.hover(target('licenses', 8))
    hoverOnly.refresh({ licenses: 9 })
    expect(hoverOnly.snapshot()).toEqual({ hovered: null, locked: null })
  })

  it('publishes independent snapshots that cannot replace internal state', () => {
    const changes: InteractionSnapshot[] = []
    const controller = createScreenInteractionController((snapshot) => {
      changes.push(snapshot)
      snapshot.hovered = null
      snapshot.locked = null
    })
    const hovered = target('risks', 12)
    const locked = target('licenses', 8)

    controller.hover(hovered)
    expect(controller.active()).toBe(hovered)

    const snapshot = controller.snapshot()
    snapshot.hovered = null
    expect(controller.active()).toBe(hovered)

    controller.leave()
    controller.lock(locked)
    controller.clear()
    controller.refresh({ licenses: 9 })

    expect(changes).toHaveLength(5)
    expect(new Set(changes).size).toBe(5)
    expect(controller.snapshot()).toEqual({ hovered: null, locked: null })
  })
})
