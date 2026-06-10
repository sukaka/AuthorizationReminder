import { describe, expect, it } from 'vitest'

import { applyEdit, createEditorState } from '../src/editor'
import { screenManifests } from '../src/templates/manifests'

const template = screenManifests[0]!

describe('screen editor constraints', () => {
  it('rejects moving a widget outside declared areas', () => {
    const state = createEditorState(template)

    expect(() => applyEdit(template, state, {
      type: 'set-position',
      widgetId: 'sca-01-core',
      layout: 'widescreen',
      area: 'undeclared-area',
      x: 0,
      y: 0,
    })).toThrow('Layout area is not allowed')
  })

  it('rejects hiding required widgets', () => {
    const state = createEditorState(template)

    expect(() => applyEdit(template, state, {
      type: 'set-hidden',
      widgetId: 'sca-01-core',
      hidden: true,
    })).toThrow('Required widget cannot be hidden')
  })

  it('rejects sizes outside widget constraints', () => {
    const state = createEditorState(template)

    expect(() => applyEdit(template, state, {
      type: 'set-size',
      widgetId: 'sca-01-core',
      layout: 'widescreen',
      width: 2,
      height: 2,
    })).toThrow('Widget size is outside allowed bounds')
  })
})
