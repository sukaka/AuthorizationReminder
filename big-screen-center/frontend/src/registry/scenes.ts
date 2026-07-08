import type { EffectsProfile, InteractionSnapshot } from '../types'

export interface SceneInteractionDatum {
  key: string
  value?: number
}

export interface SceneInteractionHandlers {
  onHover(target: SceneInteractionDatum | null): void
  onSelect(target: SceneInteractionDatum): void
}

export interface ManagedScene {
  start(): void
  pause(): void
  resize(width: number, height: number, pixelRatio: number): void
  update(data: unknown): void
  setInteraction?(snapshot: InteractionSnapshot): void
  setInteractionHandlers?(handlers: SceneInteractionHandlers): void
  dispose(): void
}

export interface SceneModule {
  createScene(container: HTMLElement, profile: EffectsProfile): ManagedScene
}

export const sceneRegistry = {
  'risk-globe': () => import('../scenes/createRiskGlobe'),
  'course-galaxy': () => import('../scenes/createCourseGalaxy'),
  'expiry-orbit': () => import('../scenes/createExpiryOrbit'),
  'dependency-space': () => import('../scenes/createRiskGlobe'),
  'scan-pipeline': () => import('../scenes/createExpiryOrbit'),
  'growth-stairway': () => import('../scenes/createCourseGalaxy'),
} as const satisfies Record<string, () => Promise<SceneModule>>

export type SceneKey = keyof typeof sceneRegistry

export const resolveSceneLoader = (key: string) =>
  sceneRegistry[key as SceneKey] || null
