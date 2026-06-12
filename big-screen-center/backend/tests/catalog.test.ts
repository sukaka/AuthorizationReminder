import { describe, expect, it } from 'vitest'

import { screenCatalog } from '../src/catalog.js'
import { ScreenTemplateSchema } from '../src/contracts.js'

const baseTemplate = {
  id: 'sca-01',
  systemKey: 'sca',
  name: '全域安全态势',
  version: 1,
  themeKey: 'security-orbit',
  effectsProfile: 'high',
  layouts: {
    widescreen: { width: 1920, height: 1080, areas: ['hero', 'left', 'right', 'footer'] },
    ultrawide: { width: 3840, height: 1080, areas: ['left', 'hero', 'right', 'footer', 'far-right'] },
  },
  widgets: [
    {
      id: 'overview',
      type: 'metric-cards',
      dataSourceKey: 'security-overview',
      layoutArea: 'left',
      optional: false,
      minWidth: 2,
      minHeight: 2,
      maxWidth: 6,
      maxHeight: 6,
      config: {},
    },
    {
      id: 'hero',
      type: 'three-scene',
      dataSourceKey: 'security-overview',
      layoutArea: 'hero',
      optional: false,
      minWidth: 4,
      minHeight: 4,
      maxWidth: 12,
      maxHeight: 12,
      config: { sceneKey: 'risk-globe' },
    },
    {
      id: 'trend',
      type: 'echart',
      dataSourceKey: 'security-overview',
      layoutArea: 'right',
      optional: true,
      minWidth: 2,
      minHeight: 2,
      maxWidth: 6,
      maxHeight: 6,
      config: { variant: 'trend' },
    },
    {
      id: 'ranking',
      type: 'ranking-table',
      dataSourceKey: 'security-overview',
      layoutArea: 'footer',
      optional: true,
      minWidth: 2,
      minHeight: 2,
      maxWidth: 6,
      maxHeight: 6,
      config: {},
    },
  ],
  filters: [],
  interactions: [
    {
      key: 'criticalRisks',
      label: '严重风险',
      group: 'risk',
      relatedKeys: [],
      detailPath: '/',
      description: '严重风险数量',
    },
  ],
  refreshPolicy: { mode: 'poll', intervalMs: 30000 },
} as const

describe('ScreenTemplateSchema', () => {
  it.each([
    ['script', { script: 'alert(1)' }],
    ['html', { html: '<iframe src=x>' }],
    ['sql', { sql: 'select * from users' }],
    ['url', { url: 'https://unapproved.example/a.json' }],
    ['nested endpoint', { nested: { endpoint: '/api/private' } }],
  ])('rejects forbidden %s config', (_name, config) => {
    expect(() =>
      ScreenTemplateSchema.parse({
        ...baseTemplate,
        widgets: baseTemplate.widgets.map((widget, index) =>
          index === 0 ? { ...widget, config } : widget,
        ),
      }),
    ).toThrow()
  })

  it.each([
    ['HTML', { description: '<strong>unsafe</strong>' }],
    ['SQL', { queryText: 'SELECT * FROM users' }],
    ['remote URL', { assetPath: 'https://cdn.example/model.glb' }],
    ['script protocol', { action: 'javascript:alert(1)' }],
    ['function body', { formatter: '(value) => value.toFixed(2)' }],
  ])('rejects %s hidden inside an allowed config key', (_name, config) => {
    expect(() =>
      ScreenTemplateSchema.parse({
        ...baseTemplate,
        widgets: baseTemplate.widgets.map((widget, index) =>
          index === 0 ? { ...widget, config } : widget,
        ),
      }),
    ).toThrow()
  })

  it('rejects widget minimum dimensions above maximum dimensions', () => {
    expect(() =>
      ScreenTemplateSchema.parse({
        ...baseTemplate,
        widgets: baseTemplate.widgets.map((widget, index) =>
          index === 0 ? { ...widget, minWidth: 7, maxWidth: 6 } : widget,
        ),
      }),
    ).toThrow('Widget min size must not exceed max size')
  })

  it('rejects widgets assigned outside both declared layouts', () => {
    expect(() =>
      ScreenTemplateSchema.parse({
        ...baseTemplate,
        widgets: baseTemplate.widgets.map((widget, index) =>
          index === 0 ? { ...widget, layoutArea: 'unknown' } : widget,
        ),
      }),
    ).toThrow('Widget layout area must exist in both layouts')
  })

  it('rejects a template id whose prefix does not match its system', () => {
    expect(() =>
      ScreenTemplateSchema.parse({
        ...baseTemplate,
        systemKey: 'reminder',
      }),
    ).toThrow('Template id prefix must match system key')
  })

  it('rejects more than one persistent three scene', () => {
    expect(() =>
      ScreenTemplateSchema.parse({
        ...baseTemplate,
        widgets: baseTemplate.widgets.map((widget, index) =>
          index === 2
            ? {
                ...widget,
                type: 'three-scene',
                config: { variant: 'core', visualKey: 'second-scene' },
              }
            : widget,
        ),
      }),
    ).toThrow('Template may contain at most one Three.js scene')
  })
})

describe('screenCatalog', () => {
  it('accepts catalog interactions and rejects unsafe detail paths', () => {
    const parsed = ScreenTemplateSchema.parse(screenCatalog[0])
    const interactions = parsed.interactions

    expect(
      interactions.length > 0
        && interactions.every((item) => item.detailPath === '/'),
    ).toBe(true)

    for (const detailPath of [
      'javascript:alert(1)',
      '//evil.example/a',
      'https://evil.example/a',
    ]) {
      expect(() =>
        ScreenTemplateSchema.parse({
          ...screenCatalog[0],
          interactions: [
            {
              key: 'criticalRisks',
              label: '严重风险',
              group: 'risk',
              relatedKeys: [],
              detailPath,
              description: '严重风险数量',
            },
          ],
        }),
      ).toThrow()
    }
  })

  it('contains twelve schema-valid templates distributed 5/4/3', () => {
    expect(screenCatalog).toHaveLength(12)
    expect(screenCatalog.map((template) => ScreenTemplateSchema.parse(template))).toHaveLength(12)

    const counts = Object.fromEntries(
      ['sca', 'train-exam', 'reminder'].map((systemKey) => [
        systemKey,
        screenCatalog.filter((template) => template.systemKey === systemKey).length,
      ]),
    )
    expect(counts).toEqual({ sca: 5, 'train-exam': 4, reminder: 3 })
  })

  it('uses unique ids and at most one persistent three scene per template', () => {
    expect(new Set(screenCatalog.map((template) => template.id)).size).toBe(12)
    for (const template of screenCatalog) {
      expect(template.widgets.filter((widget) => widget.type === 'three-scene').length).toBeLessThanOrEqual(1)
    }
  })
})
