import {
  computed,
  inject,
  provide,
  type ComputedRef,
  type InjectionKey,
} from 'vue'

import type { SystemKey } from '../types'

export interface ScreenTheme {
  canvas: string
  stage: string
  surface: string
  surfaceSolid: string
  text: string
  muted: string
  line: string
  grid: string
  accent: string
  accentSecondary: string
  signal: string
  warning: string
  danger: string
  idle: string
  shadow: string
}

const shared = {
  canvas: '#f4f9fc',
  stage: '#e9f2f7',
  surface: 'rgb(255 255 255 / 84%)',
  surfaceSolid: '#fbfdfe',
  text: '#102a43',
  muted: '#688197',
  line: 'rgb(35 91 137 / 15%)',
  grid: 'rgb(49 116 157 / 5.5%)',
  signal: '#29c58b',
  warning: '#f3ab28',
  danger: '#f0645a',
  idle: '#e6eff4',
  shadow: 'rgb(34 92 129 / 9%)',
} satisfies Omit<ScreenTheme, 'accent' | 'accentSecondary'>

export const SCREEN_THEMES = {
  sca: { ...shared, accent: '#1976ed', accentSecondary: '#18b8c9' },
  'train-exam': { ...shared, accent: '#008b78', accentSecondary: '#35a7d6' },
  reminder: { ...shared, accent: '#e5663f', accentSecondary: '#e6a52d' },
} as const satisfies Record<SystemKey, ScreenTheme>

export const screenThemeFor = (systemKey: SystemKey): ScreenTheme =>
  SCREEN_THEMES[systemKey]

export const screenThemeCssVariables = (
  theme: ScreenTheme,
): Record<string, string> => ({
  '--screen-canvas': theme.canvas,
  '--screen-stage': theme.stage,
  '--screen-surface': theme.surface,
  '--screen-surface-solid': theme.surfaceSolid,
  '--screen-text': theme.text,
  '--screen-muted': theme.muted,
  '--screen-line': theme.line,
  '--screen-grid': theme.grid,
  '--screen-accent': theme.accent,
  '--screen-accent-secondary': theme.accentSecondary,
  '--screen-signal': theme.signal,
  '--screen-warning': theme.warning,
  '--screen-danger': theme.danger,
  '--screen-idle': theme.idle,
  '--screen-shadow': theme.shadow,
})

export const screenThemeKey: InjectionKey<ComputedRef<ScreenTheme>> =
  Symbol('screen-theme')

export const provideScreenTheme = (systemKey: ComputedRef<SystemKey>) => {
  const theme = computed(() => screenThemeFor(systemKey.value))
  provide(screenThemeKey, theme)
  return theme
}

export const useScreenTheme = () => {
  const theme = inject(screenThemeKey)
  if (!theme) throw new Error('Screen theme provider is missing')
  return theme
}
