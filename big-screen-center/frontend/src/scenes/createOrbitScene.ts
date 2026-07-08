import * as THREE from 'three'

import { numericMetricEntries } from '../metric-labels'
import type { EffectsProfile, InteractionSnapshot, JsonValue } from '../types'
import type {
  ManagedScene,
  SceneInteractionDatum,
  SceneInteractionHandlers,
} from '../registry/scenes'

interface OrbitSceneOptions {
  colors: [number, number, number]
  ringCount: number
  tilt: number
}

const particleCount = {
  high: 6000,
  medium: 2500,
  low: 0,
} satisfies Record<EffectsProfile, number>

const pixelRatioCap = {
  high: 1.75,
  medium: 1.25,
  low: 1,
} satisfies Record<EffectsProfile, number>

const disposeMaterial = (material: THREE.Material | THREE.Material[]) => {
  const materials = Array.isArray(material) ? material : [material]
  for (const item of materials) {
    for (const value of Object.values(item)) {
      if (value instanceof THREE.Texture) value.dispose()
    }
    item.dispose()
  }
}

export function createOrbitScene(
  container: HTMLElement,
  profile: EffectsProfile,
  options: OrbitSceneOptions,
): ManagedScene {
  const canvas = document.createElement('canvas')
  const contextAttributes: WebGLContextAttributes = {
    alpha: true,
    antialias: true,
  }
  const context = canvas.getContext('webgl2', contextAttributes)
  if (!context) {
    throw new Error('WebGL2 context is unavailable')
  }
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    canvas,
    context,
  })
  renderer.setClearColor(0x000000, 0)
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100)
  camera.position.set(0, 0.4, 7.2)

  const root = new THREE.Group()
  root.rotation.x = options.tilt
  scene.add(root)

  const selectableObjects: THREE.Mesh[] = []

  options.colors.forEach((color, index) => {
    const geometry = new THREE.TorusGeometry(1.25 + index * 0.68, 0.018, 10, 180)
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.42 + index * 0.12,
    })
    const ring = new THREE.Mesh(geometry, material)
    ring.rotation.x = Math.PI / 2 + index * 0.22
    ring.rotation.y = index * 0.37
    ring.userData.baseColor = color
    ring.userData.baseOpacity = 0.42 + index * 0.12
    root.add(ring)
    selectableObjects.push(ring)
  })

  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.68, 2),
    new THREE.MeshBasicMaterial({
      color: options.colors[0],
      wireframe: true,
      transparent: true,
      opacity: 0.76,
    }),
  )
  core.userData.baseColor = options.colors[0]
  core.userData.baseOpacity = 0.76
  root.add(core)
  selectableObjects.push(core)

  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  let interactionHandlers: SceneInteractionHandlers | null = null

  const count = particleCount[profile]
  if (count > 0) {
    const positions = new Float32Array(count * 3)
    for (let index = 0; index < count; index += 1) {
      const progress = index / count
      const radius = 2.2 + (index % options.ringCount) * 0.46
      const angle = progress * Math.PI * 2 * options.ringCount
      positions[index * 3] = Math.cos(angle) * radius
      positions[index * 3 + 1] = Math.sin(angle * 1.7) * 0.55
      positions[index * 3 + 2] = Math.sin(angle) * radius
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    root.add(
      new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          color: options.colors[1],
          opacity: 0.42,
          size: 0.018,
          transparent: true,
        }),
      ),
    )
  }

  let frameId = 0
  let running = false
  let disposed = false

  const datumFromObject = (object: THREE.Object3D): SceneInteractionDatum | null => {
    const key = String(object.userData.metricKey || '')
    const value = Number(object.userData.metricValue)
    if (!key) return null
    return {
      key,
      value: Number.isFinite(value) ? value : undefined,
    }
  }

  const hitTest = (event: PointerEvent) => {
    const bounds = renderer.domElement.getBoundingClientRect()
    const width = Math.max(bounds.width, 1)
    const height = Math.max(bounds.height, 1)
    pointer.x = ((event.clientX - bounds.left) / width) * 2 - 1
    pointer.y = -(((event.clientY - bounds.top) / height) * 2 - 1)
    raycaster.setFromCamera(pointer, camera)
    const [hit] = raycaster.intersectObjects(selectableObjects, false)
    return hit?.object ? datumFromObject(hit.object) : null
  }

  const onPointerMove = (event: PointerEvent) => {
    interactionHandlers?.onHover(hitTest(event))
  }

  const onPointerLeave = () => {
    interactionHandlers?.onHover(null)
  }

  const onClick = (event: PointerEvent) => {
    const datum = hitTest(event)
    if (datum) interactionHandlers?.onSelect(datum)
  }

  renderer.domElement.addEventListener('pointermove', onPointerMove)
  renderer.domElement.addEventListener('pointerleave', onPointerLeave)
  renderer.domElement.addEventListener('click', onClick)

  const applyObjectRelation = (
    object: THREE.Mesh,
    relation: 'primary' | 'related' | 'none',
  ) => {
    const material = object.material as THREE.MeshBasicMaterial
    const baseColor = Number(object.userData.baseColor || options.colors[0])
    material.color.set(relation === 'primary' ? 0xffffff : baseColor)
    material.opacity = relation === 'primary'
      ? 0.95
      : relation === 'related'
        ? Math.max(Number(object.userData.baseOpacity || 0.5), 0.72)
        : 0.28
    if (profile !== 'low') {
      object.scale.setScalar(relation === 'primary' ? 1.1 : 1)
    }
  }

  const setInteraction = (snapshot: InteractionSnapshot) => {
    const active = snapshot.hovered || snapshot.locked
    selectableObjects.forEach((object) => {
      const key = String(object.userData.metricKey || '')
      if (!active || !key) {
        applyObjectRelation(object, 'none')
        return
      }
      const relation = active.key === key
        ? 'primary'
        : active.relatedKeys.includes(key)
          ? 'related'
          : 'none'
      applyObjectRelation(object, relation)
    })
    renderer.render(scene, camera)
  }

  const render = () => {
    if (!running || disposed) return
    root.rotation.y += profile === 'high' ? 0.0018 : 0.001
    core.rotation.x -= 0.002
    renderer.render(scene, camera)
    frameId = requestAnimationFrame(render)
  }

  const start = () => {
    if (running || disposed || document.hidden) return
    running = true
    frameId = requestAnimationFrame(render)
  }

  const pause = () => {
    running = false
    if (frameId) cancelAnimationFrame(frameId)
    frameId = 0
  }

  const onVisibilityChange = () => {
    if (document.hidden) pause()
    else start()
  }
  document.addEventListener('visibilitychange', onVisibilityChange)

  return {
    start,
    pause,
    resize(width, height, pixelRatio) {
      camera.aspect = Math.max(width, 1) / Math.max(height, 1)
      camera.updateProjectionMatrix()
      renderer.setPixelRatio(Math.min(pixelRatio, pixelRatioCap[profile]))
      renderer.setSize(Math.max(width, 1), Math.max(height, 1), false)
      renderer.render(scene, camera)
    },
    update(data) {
      const serialized = JSON.stringify(data)
      const signal = Math.min(serialized.length / 5000, 1)
      core.scale.setScalar(0.88 + signal * 0.28)
      const entries = numericMetricEntries(data as JsonValue, selectableObjects.length)
      selectableObjects.forEach((object, index) => {
        const entry = entries[index]
        if (!entry) {
          delete object.userData.metricKey
          delete object.userData.metricValue
          return
        }
        const [key, value] = entry
        object.userData.metricKey = key
        object.userData.metricValue = value
      })
    },
    setInteraction,
    setInteractionHandlers(handlers) {
      interactionHandlers = handlers
    },
    dispose() {
      disposed = true
      pause()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave)
      renderer.domElement.removeEventListener('click', onClick)
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh || object instanceof THREE.Points)) return
        object.geometry.dispose()
        disposeMaterial(object.material)
      })
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
