import type { EffectsProfile } from '../types'
import { createOrbitScene } from './createOrbitScene'

export const createScene = (container: HTMLElement, profile: EffectsProfile) =>
  createOrbitScene(container, profile, {
    colors: [0xff775d, 0xf2b84b, 0xb8d26f],
    ringCount: 4,
    tilt: -0.5,
  })
