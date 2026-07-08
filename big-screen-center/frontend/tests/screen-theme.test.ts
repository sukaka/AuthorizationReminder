import { describe, expect, it } from 'vitest'

import {
  SCREEN_THEMES,
  screenThemeCssVariables,
  screenThemeFor,
} from '../src/theme/screen-theme'

describe('bright screen themes', () => {
  it('defines one bright porcelain theme per system', () => {
    expect(Object.keys(SCREEN_THEMES)).toEqual([
      'sca',
      'train-exam',
      'reminder',
    ])

    for (const theme of Object.values(SCREEN_THEMES)) {
      expect(theme.canvas).toBe('#f4f9fc')
      expect(theme.stage).toBe('#e9f2f7')
      expect(theme.surface).toBe('rgb(255 255 255 / 84%)')
      expect(theme.surfaceSolid).toBe('#fbfdfe')
      expect(theme.text).toBe('#102a43')
      expect(theme.muted).toBe('#688197')
      expect(theme.line).toBe('rgb(35 91 137 / 15%)')
      expect(theme.grid).toBe('rgb(49 116 157 / 5.5%)')
      expect(theme.signal).toBe('#29c58b')
      expect(theme.warning).toBe('#f3ab28')
      expect(theme.danger).toBe('#f0645a')
      expect(theme.idle).toBe('#e6eff4')
      expect(theme.shadow).toBe('rgb(34 92 129 / 9%)')
    }
  })

  it('keeps system accents distinct', () => {
    expect(screenThemeFor('sca').accent).toBe('#1976ed')
    expect(screenThemeFor('sca').accentSecondary).toBe('#18b8c9')
    expect(screenThemeFor('train-exam').accent).toBe('#008b78')
    expect(screenThemeFor('train-exam').accentSecondary).toBe('#35a7d6')
    expect(screenThemeFor('reminder').accent).toBe('#e5663f')
    expect(screenThemeFor('reminder').accentSecondary).toBe('#e6a52d')
  })

  it('maps the complete theme to CSS variables', () => {
    expect(screenThemeCssVariables(screenThemeFor('sca'))).toEqual({
      '--screen-canvas': '#f4f9fc',
      '--screen-stage': '#e9f2f7',
      '--screen-surface': 'rgb(255 255 255 / 84%)',
      '--screen-surface-solid': '#fbfdfe',
      '--screen-text': '#102a43',
      '--screen-muted': '#688197',
      '--screen-line': 'rgb(35 91 137 / 15%)',
      '--screen-grid': 'rgb(49 116 157 / 5.5%)',
      '--screen-accent': '#1976ed',
      '--screen-accent-secondary': '#18b8c9',
      '--screen-signal': '#29c58b',
      '--screen-warning': '#f3ab28',
      '--screen-danger': '#f0645a',
      '--screen-idle': '#e6eff4',
      '--screen-shadow': 'rgb(34 92 129 / 9%)',
    })
  })
})
