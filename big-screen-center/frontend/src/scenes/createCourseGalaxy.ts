import type { EffectsProfile } from '../types'
import { createOrbitScene } from './createOrbitScene'

export const createScene = (container: HTMLElement, profile: EffectsProfile) =>
  createOrbitScene(container, profile, {
    colors: [0xf4c65e, 0x73c6a6, 0xd98c5f],
    ringCount: 7,
    tilt: 0.36,
  })
