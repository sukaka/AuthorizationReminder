import { describe, expect, it } from 'vitest'

import { screenCatalog } from '../../backend/src/catalog'
import { screenManifests } from '../src/templates/manifests'

describe('template interaction manifests', () => {
  it('defines Chinese interaction metadata for all twelve templates', () => {
    expect(screenManifests).toHaveLength(12)
    for (const template of screenManifests) {
      const interactions = template.interactions

      expect(interactions.length).toBeGreaterThanOrEqual(8)
      expect(new Set(interactions.map((item) => item.key)).size)
        .toBe(interactions.length)
      for (const item of interactions) {
        expect(item.label).toMatch(/[\u4e00-\u9fff]/)
        expect(item.group).toMatch(/^[a-z][a-z0-9-]*$/)
        expect(item.description).toMatch(/[\u4e00-\u9fff]/)
        expect(item.detailPath).toBe('/')
        expect(item.relatedKeys).not.toContain(item.key)
      }
    }
  })

  it('keeps every related key inside its template catalog', () => {
    for (const template of screenManifests) {
      const interactions = template.interactions

      const keys = new Set(interactions.map((item) => item.key))
      for (const item of interactions) {
        for (const related of item.relatedKeys) {
          expect(keys.has(related)).toBe(true)
        }
      }
    }
  })

  it('keeps frontend and backend interaction catalogs equivalent', () => {
    expect(
      screenManifests.map(({ id, interactions }) => ({ id, interactions })),
    ).toEqual(
      screenCatalog.map(({ id, interactions }) => ({ id, interactions })),
    )
  })
})
