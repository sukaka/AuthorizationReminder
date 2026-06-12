<script setup lang="ts">
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { onMounted, onUnmounted, ref } from 'vue'

import type { EffectsProfile, JsonValue, WidgetDefinition } from '../../types'
import { widgetTitle } from '../../metric-labels'

defineProps<{
  widget: WidgetDefinition
  data: JsonValue
  performanceProfile: EffectsProfile
}>()

const host = ref<HTMLElement | null>(null)
let map: maplibregl.Map | null = null

onMounted(() => {
  if (!host.value) return
  map = new maplibregl.Map({
    container: host.value,
    style: '/assets/maps/style-offline.json',
    center: [104, 35],
    zoom: 2.5,
    attributionControl: false,
    interactive: false,
    fadeDuration: 0,
  })
})

onUnmounted(() => map?.remove())
</script>

<template>
  <section class="map-panel" data-widget="map" data-widget-type="map">
    <div ref="host" class="map-panel__canvas" />
    <div class="map-panel__legend">
      <span>本地离线地图</span>
      <strong>{{ widgetTitle(widget.config.variant) }}</strong>
    </div>
  </section>
</template>

<style scoped>
.map-panel,
.map-panel__canvas {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
}

.map-panel {
  overflow: hidden;
  background: #12100c;
  border: 1px solid var(--screen-line);
}

.map-panel__canvas :deep(.maplibregl-canvas) {
  opacity: 0.9;
}

.map-panel__legend {
  position: absolute;
  left: 24px;
  bottom: 20px;
}

.map-panel__legend span,
.map-panel__legend strong {
  display: block;
}

.map-panel__legend span {
  color: var(--screen-muted);
  font-size: 9px;
  letter-spacing: 0.18em;
}

.map-panel__legend strong {
  margin-top: 5px;
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 500;
  text-transform: uppercase;
}
</style>
