import type { EffectsProfile } from '../types'
import { createOrbitScene } from './createOrbitScene'

export const createScene = (container: HTMLElement, profile: EffectsProfile) =>
  createOrbitScene(container, profile, {
    colors: [0xffb23f, 0xe85d3f, 0x9bd46a],
    ringCount: 5,
    tilt: -0.22,
  })
