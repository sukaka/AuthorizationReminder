<script setup lang="ts">
import type { Container, Engine } from '@tsparticles/engine'
import { onMounted, onUnmounted } from 'vue'

const props = defineProps<{
  id: string
}>()

let particles: Container | undefined

const globalState = globalThis as typeof globalThis & {
  __bigScreenParticlesReady?: Promise<Engine>
}

const loadParticlesEngine = () => {
  globalState.__bigScreenParticlesReady ||= Promise.all([
    import('@tsparticles/engine'),
    import('tsparticles'),
  ]).then(async ([{ tsParticles }, { loadFull }]) => {
    await loadFull(tsParticles)
    return tsParticles
  }).catch((error) => {
    delete globalState.__bigScreenParticlesReady
    throw error
  })
  return globalState.__bigScreenParticlesReady
}

onMounted(async () => {
  const tsParticles = await loadParticlesEngine()
  particles = await tsParticles.load({
    id: props.id,
    options: {
      fullScreen: { enable: false },
      fpsLimit: 30,
      detectRetina: true,
      particles: {
        number: { value: 42, density: { enable: true } },
        color: { value: ['#f2b84b', '#ff775d'] },
        links: {
          enable: true,
          color: '#8c7550',
          distance: 130,
          opacity: 0.18,
          width: 1,
        },
        move: {
          enable: true,
          speed: 0.45,
          direction: 'none',
          outModes: { default: 'bounce' },
        },
        opacity: { value: { min: 0.15, max: 0.45 } },
        size: { value: { min: 1, max: 3 } },
      },
    },
  })
})

onUnmounted(() => particles?.destroy())
</script>

<template>
  <div :id="id" class="particle-veil" aria-hidden="true" />
</template>

<style scoped>
.particle-veil {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.particle-veil :deep(canvas) {
  position: absolute !important;
  inset: 0;
}
</style>
