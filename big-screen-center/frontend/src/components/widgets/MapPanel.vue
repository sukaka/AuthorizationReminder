<script setup lang="ts">
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { computed, onMounted, onUnmounted, ref } from 'vue'

import type { EffectsProfile, JsonValue, WidgetDefinition } from '../../types'
import { metricLabel, numericMetricEntries, widgetTitle } from '../../metric-labels'
import { useScreenInteraction } from '../../interactions/useScreenInteraction'

const props = defineProps<{
  widget: WidgetDefinition
  data: JsonValue
  performanceProfile: EffectsProfile
}>()

const host = ref<HTMLElement | null>(null)
const interaction = useScreenInteraction()
let map: maplibregl.Map | null = null
let pointLayerBound = false

type BusinessPointFeature = {
  type: 'Feature'
  geometry: {
    type: 'Point'
    coordinates: [number, number]
  }
  properties: {
    metricKey: string
    label: string
    value: number
  }
}

type MapLayerEvent = {
  features?: unknown[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const isValidPointFeature = (value: unknown): value is BusinessPointFeature => {
  if (!isRecord(value)) return false
  const geometry = value.geometry
  const properties = value.properties
  if (!isRecord(geometry) || !isRecord(properties)) return false
  if (value.type !== 'Feature' || geometry.type !== 'Point') return false
  if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2) return false
  const [lng, lat] = geometry.coordinates
  return (
    Number.isFinite(lng)
    && Number.isFinite(lat)
    && typeof properties.metricKey === 'string'
    && properties.metricKey.length > 0
    && typeof properties.label === 'string'
    && properties.label.length > 0
    && typeof properties.value === 'number'
    && Number.isFinite(properties.value)
  )
}

const businessGeoJson = computed(() => {
  if (!isRecord(props.data)) return null
  const raw = props.data.geojson
  if (!isRecord(raw) || raw.type !== 'FeatureCollection' || !Array.isArray(raw.features)) {
    return null
  }
  const features = raw.features.filter(isValidPointFeature)
  if (features.length === 0) return null
  return {
    type: 'FeatureCollection' as const,
    features,
  }
})

const fallbackEntries = computed(() =>
  businessGeoJson.value ? [] : numericMetricEntries(props.data, 4),
)

const targetForMapFeature = (feature: BusinessPointFeature) =>
  interaction.targetFor(
    props.widget,
    feature.properties.metricKey,
    feature.properties.value,
    'map',
  )

const firstFeatureFromEvent = (event?: unknown) => {
  if (!event || typeof event !== 'object') return null
  const [feature] = (event as MapLayerEvent).features || []
  return isValidPointFeature(feature) ? feature : null
}

const onPointEnter = (event?: unknown) => {
  const feature = firstFeatureFromEvent(event)
  if (feature) interaction.hover(targetForMapFeature(feature))
}

const onPointLeave = () => {
  interaction.leave()
}

const onPointClick = (event?: unknown) => {
  const feature = firstFeatureFromEvent(event)
  if (feature) interaction.lock(targetForMapFeature(feature))
}

const onMapClick = (event?: unknown) => {
  if (!firstFeatureFromEvent(event)) interaction.clear()
}

const setupBusinessPoints = () => {
  if (!map || !businessGeoJson.value) return
  map.addSource('business-points', {
    type: 'geojson',
    data: businessGeoJson.value,
  })
  map.addLayer({
    id: 'business-points-layer',
    type: 'circle',
    source: 'business-points',
    paint: {
      'circle-radius': 8,
      'circle-color': '#f2b84b',
      'circle-stroke-color': '#15110d',
      'circle-stroke-width': 2,
      'circle-opacity': 0.9,
    },
  })
  map.on('mouseenter', 'business-points-layer', onPointEnter)
  map.on('mouseleave', 'business-points-layer', onPointLeave)
  map.on('click', 'business-points-layer', onPointClick)
  pointLayerBound = true
}

const hoverFallbackMetric = (key: string, value: number) => {
  interaction.hover(interaction.targetFor(props.widget, key, value, 'map'))
}

const lockFallbackMetric = (key: string, value: number) => {
  interaction.lock(interaction.targetFor(props.widget, key, value, 'map'))
}

onMounted(() => {
  if (!host.value) return
  map = new maplibregl.Map({
    container: host.value,
    style: '/assets/maps/style-offline.json',
    center: [104, 35],
    zoom: 2.5,
    attributionControl: false,
    interactive: true,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    fadeDuration: 0,
  })
  map.on('load', setupBusinessPoints)
  map.on('click', onMapClick)
})

onUnmounted(() => {
  if (map && pointLayerBound) {
    map.off('mouseenter', 'business-points-layer', onPointEnter)
    map.off('mouseleave', 'business-points-layer', onPointLeave)
    map.off('click', 'business-points-layer', onPointClick)
  }
  map?.off('load', setupBusinessPoints)
  map?.off('click', onMapClick)
  map?.remove()
})
</script>

<template>
  <section class="map-panel" data-widget="map" data-widget-type="map">
    <div ref="host" class="map-panel__canvas" />
    <div
      v-if="fallbackEntries.length"
      class="map-panel__metrics"
      aria-label="地图聚合指标"
    >
      <button
        v-for="[key, value] in fallbackEntries"
        :key="key"
        type="button"
        class="map-panel__metric"
        :class="{ 'is-active': interaction.relationFor(key) !== 'none' }"
        data-map-metric
        @pointerenter="hoverFallbackMetric(key, value)"
        @focus="hoverFallbackMetric(key, value)"
        @pointerleave="interaction.leave()"
        @blur="interaction.leave()"
        @click="lockFallbackMetric(key, value)"
        @keydown.enter.prevent="lockFallbackMetric(key, value)"
        @keydown.space.prevent="lockFallbackMetric(key, value)"
      >
        <span>{{ metricLabel(key) }}</span>
        <strong>{{ value }}</strong>
      </button>
    </div>
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

.map-panel__metrics {
  position: absolute;
  right: 24px;
  bottom: 24px;
  z-index: 2;
  display: grid;
  grid-template-columns: repeat(2, minmax(110px, 1fr));
  gap: 8px;
  max-width: min(360px, calc(100% - 48px));
}

.map-panel__metric {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  padding: 10px 12px;
  color: var(--screen-text);
  background: rgb(18 16 12 / 78%);
  border: 1px solid rgb(242 184 75 / 32%);
  box-shadow: 0 0 20px rgb(242 184 75 / 10%);
  cursor: pointer;
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;
}

.map-panel__metric:hover,
.map-panel__metric:focus-visible,
.map-panel__metric.is-active {
  border-color: var(--screen-accent);
  box-shadow: 0 0 28px rgb(242 184 75 / 24%);
  transform: translateY(-1px);
}

.map-panel__metric span {
  overflow: hidden;
  color: var(--screen-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.map-panel__metric strong {
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 500;
}

.map-panel__legend {
  position: absolute;
  left: 24px;
  bottom: 20px;
  z-index: 2;
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
