<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { widgetTitle } from '../../metric-labels'
import { resolveSceneLoader, type ManagedScene } from '../../registry/scenes'
import type { EffectsProfile, JsonValue, WidgetDefinition } from '../../types'
import { useScreenInteraction } from '../../interactions/useScreenInteraction'
import EChartPanel from './EChartPanel.vue'

const props = defineProps<{
  widget: WidgetDefinition
  data: JsonValue
  performanceProfile: EffectsProfile
}>()

const host = ref<HTMLElement | null>(null)
const failed = ref(false)
const interaction = useScreenInteraction()
let managedScene: ManagedScene | null = null
let observer: ResizeObserver | null = null

const sceneKey = computed(() => String(props.widget.config.visualKey || ''))
const sceneTitle = computed(() => widgetTitle(sceneKey.value))
const fallbackWidget = computed<WidgetDefinition>(() => ({
  ...props.widget,
  type: 'echart',
  config: { ...props.widget.config, variant: 'polar-fallback' },
}))

onMounted(async () => {
  const loader = resolveSceneLoader(sceneKey.value)
  if (!host.value || !loader || props.performanceProfile === 'low') {
    failed.value = true
    return
  }
  try {
    const module = await loader()
    managedScene = module.createScene(host.value, props.performanceProfile)
    managedScene.setInteractionHandlers?.({
      onHover(target) {
        if (!target) {
          interaction.leave()
          return
        }
        interaction.hover(
          interaction.targetFor(props.widget, target.key, target.value, 'three'),
        )
      },
      onSelect(target) {
        interaction.lock(
          interaction.targetFor(props.widget, target.key, target.value, 'three'),
        )
      },
    })
    managedScene.setInteraction?.(interaction.snapshot.value)
    managedScene.update(props.data)
    observer = new ResizeObserver(([entry]) => {
      managedScene?.resize(
        entry.contentRect.width,
        entry.contentRect.height,
        window.devicePixelRatio || 1,
      )
    })
    observer.observe(host.value)
    const bounds = host.value.getBoundingClientRect()
    managedScene.resize(bounds.width, bounds.height, window.devicePixelRatio || 1)
    managedScene.start()
  } catch {
    managedScene?.dispose()
    managedScene = null
    host.value?.replaceChildren()
    failed.value = true
  }
})

watch(() => props.data, (next) => managedScene?.update(next), { deep: true })
watch(
  () => interaction.snapshot.value,
  (snapshot) => managedScene?.setInteraction?.(snapshot),
  { deep: true },
)
onUnmounted(() => {
  observer?.disconnect()
  managedScene?.dispose()
})
</script>

<template>
  <section
    class="three-scene"
    data-widget="three-scene"
    data-widget-type="three-scene"
    :data-three-fallback="failed ? sceneKey : undefined"
  >
    <EChartPanel
      v-if="failed"
      :widget="fallbackWidget"
      :data="data"
      :performance-profile="performanceProfile"
    />
    <div v-else ref="host" class="three-scene__canvas" />
    <div class="three-scene__label">
      <span>实时模型</span>
      <strong>{{ sceneTitle }}</strong>
    </div>
  </section>
</template>

<style scoped>
.three-scene,
.three-scene__canvas {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
}

.three-scene {
  overflow: hidden;
  background:
    radial-gradient(circle at 50% 45%, color-mix(in srgb, var(--screen-accent), transparent 86%), transparent 48%),
    linear-gradient(180deg, rgb(255 255 255 / 3%), transparent);
  border: 1px solid var(--screen-line);
}

.three-scene__canvas :deep(canvas) {
  display: block;
  width: 100%;
  height: 100%;
}

.three-scene__label {
  position: absolute;
  left: 26px;
  bottom: 22px;
  pointer-events: none;
}

.three-scene__label span,
.three-scene__label strong {
  display: block;
}

.three-scene__label span {
  color: var(--screen-muted);
  font-size: 10px;
  letter-spacing: 0.24em;
}

.three-scene__label strong {
  margin-top: 6px;
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 500;
  text-transform: uppercase;
}
</style>
