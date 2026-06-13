import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ThreeScene from '../src/components/widgets/ThreeScene.vue'
import { createOrbitScene } from '../src/scenes/createOrbitScene'
import type { WidgetDefinition } from '../src/types'
import { mountWithInteraction } from './helpers/interaction'

const mocks = vi.hoisted(() => ({
  setInteractionHandlers: vi.fn(),
  setInteraction: vi.fn(),
  createScene: vi.fn(),
  canvas: undefined as unknown as HTMLCanvasElement,
}))

class ResizeObserverStub {
  observe = vi.fn()
  disconnect = vi.fn()
}

vi.mock('../src/registry/scenes', () => ({
  resolveSceneLoader: vi.fn(() => async () => ({
    createScene: mocks.createScene,
  })),
}))

vi.mock('three', () => {
  class Texture {
    dispose = vi.fn()
  }

  class Material {
    color = { set: vi.fn() }
    opacity = 1
    dispose = vi.fn()
  }

  class Geometry {
    dispose = vi.fn()
    setAttribute = vi.fn()
  }

  class Object3D {
    rotation = { x: 0, y: 0, z: 0 }
    scale = { setScalar: vi.fn() }
    userData: Record<string, unknown> = {}
    children: Object3D[] = []

    add(object: Object3D) {
      this.children.push(object)
    }
  }

  class Mesh extends Object3D {
    constructor(
      public geometry = new Geometry(),
      public material = new Material(),
    ) {
      super()
    }
  }

  class Points extends Mesh {}

  class Scene extends Object3D {
    traverse(callback: (object: Object3D) => void) {
      const visit = (object: Object3D) => {
        callback(object)
        object.children.forEach(visit)
      }
      this.children.forEach(visit)
    }
  }

  return {
    Texture,
    Material,
    Mesh,
    Points,
    Scene,
    Group: Object3D,
    WebGLRenderer: vi.fn(function WebGLRendererMock() {
      return {
        domElement: mocks.canvas,
        setClearColor: vi.fn(),
        setPixelRatio: vi.fn(),
        setSize: vi.fn(),
        render: vi.fn(),
        dispose: vi.fn(),
      }
    }),
    PerspectiveCamera: vi.fn(function PerspectiveCameraMock() {
      return {
        aspect: 1,
        position: { set: vi.fn() },
        updateProjectionMatrix: vi.fn(),
      }
    }),
    TorusGeometry: Geometry,
    IcosahedronGeometry: Geometry,
    BufferGeometry: Geometry,
    BufferAttribute: vi.fn(),
    MeshBasicMaterial: Material,
    PointsMaterial: Material,
    Raycaster: vi.fn(function RaycasterMock() {
      return {
        setFromCamera: vi.fn(),
        intersectObjects: vi.fn(() => []),
      }
    }),
    Vector2: vi.fn(function Vector2Mock(this: { x: number; y: number }) {
      this.x = 0
      this.y = 0
    }),
  }
})

const widget: WidgetDefinition = {
  id: 'sca-01-three',
  type: 'three-scene',
  dataSourceKey: 'security-overview',
  layoutArea: 'core',
  optional: true,
  minWidth: 3,
  minHeight: 3,
  maxWidth: 12,
  maxHeight: 8,
  config: { visualKey: 'risk-globe' },
}

describe('scene interactions', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    vi.stubGlobal('WebGLRenderingContext', vi.fn())
    vi.stubGlobal('WebGL2RenderingContext', vi.fn())
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never)
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    mocks.setInteractionHandlers.mockClear()
    mocks.setInteraction.mockClear()
    mocks.createScene.mockReset()
    mocks.createScene.mockReturnValue({
      start: vi.fn(),
      pause: vi.fn(),
      resize: vi.fn(),
      update: vi.fn(),
      setInteraction: mocks.setInteraction,
      setInteractionHandlers: mocks.setInteractionHandlers,
      dispose: vi.fn(),
    })
    mocks.canvas = document.createElement('canvas')
    vi.spyOn(mocks.canvas, 'addEventListener')
    vi.spyOn(mocks.canvas, 'removeEventListener')
    vi.spyOn(mocks.canvas, 'remove').mockImplementation(() => {})
    vi.spyOn(mocks.canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 100,
      right: 200,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: vi.fn(),
    })
  })

  it('forwards scene hover and selection into the screen interaction context', async () => {
    const { api } = mountWithInteraction(ThreeScene, {
      widget,
      data: { criticalRisks: 48 },
      performanceProfile: 'high',
    })
    await flushPromises()
    const handlers = mocks.setInteractionHandlers.mock.calls[0][0]

    handlers.onHover({ key: 'criticalRisks', value: 48 })
    expect(api.active.value?.key).toBe('criticalRisks')
    expect(api.active.value?.source).toBe('three')

    handlers.onSelect({ key: 'criticalRisks', value: 48 })
    expect(api.snapshot.value.locked?.key).toBe('criticalRisks')

    handlers.onHover(null)
    expect(api.snapshot.value.hovered).toBeNull()
  })

  it('disposes pointer handlers with the scene', () => {
    const container = document.createElement('div')
    const scene = createOrbitScene(container, 'high', {
      colors: [0xffb23f, 0xe85d3f, 0x9bd46a],
      ringCount: 5,
      tilt: -0.22,
    })

    expect(mocks.canvas.addEventListener).toHaveBeenCalledWith(
      'pointermove',
      expect.any(Function),
    )
    scene.dispose()
    expect(mocks.canvas.removeEventListener).toHaveBeenCalledWith(
      'pointermove',
      expect.any(Function),
    )
    expect(mocks.canvas.removeEventListener).toHaveBeenCalledWith(
      'pointerleave',
      expect.any(Function),
    )
    expect(mocks.canvas.removeEventListener).toHaveBeenCalledWith(
      'click',
      expect.any(Function),
    )
  })
})
