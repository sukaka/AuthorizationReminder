import type { EffectsProfile } from '../types'

export interface ManagedScene {
  start(): void
  pause(): void
  resize(width: number, height: number, pixelRatio: number): void
  update(data: unknown): void
  dispose(): void
}

export interface SceneModule {
  createScene(container: HTMLElement, profile: EffectsProfile): ManagedScene
}

export const sceneRegistry = {
  'risk-globe': () => import('../scenes/createRiskGlobe'),
  'course-galaxy': () => import('../scenes/createCourseGalaxy'),
  'expiry-orbit': () => import('../scenes/createExpiryOrbit'),
} as const satisfies Record<string, () => Promise<SceneModule>>

export type SceneKey = keyof typeof sceneRegistry

export const resolveSceneLoader = (key: string) =>
  sceneRegistry[key as SceneKey] || null
