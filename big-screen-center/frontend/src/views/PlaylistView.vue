<script setup lang="ts">
import {
  computed,
  onErrorCaptured,
  onMounted,
  onUnmounted,
  ref,
} from 'vue'
import { useRouter } from 'vue-router'

import { apiRequest } from '../api'
import PlaylistPanel from '../components/PlaylistPanel.vue'
import ScreenPlayer from '../components/ScreenPlayer.vue'
import {
  createPlaylistController,
  type PlaylistItem,
} from '../playlist'
import { screenManifests } from '../templates/manifests'

const props = defineProps<{
  playlistId: string
}>()

const router = useRouter()
const mockItems: PlaylistItem[] = [
  { templateId: 'sca-01', version: 1, durationSeconds: 30, transition: 'fade', filters: {} },
  { templateId: 'train-01', version: 1, durationSeconds: 25, transition: 'slide', filters: {} },
  { templateId: 'remind-01', version: 1, durationSeconds: 25, transition: 'zoom', filters: {} },
]
const items = ref<PlaylistItem[]>([])
const currentIndex = ref(0)
const paused = ref(false)
const controlsVisible = ref(true)
const failedTemplates = ref(new Set<string>())
let controller = createPlaylistController(mockItems)
let timer = 0
let failureTimer = 0

const currentItem = computed(() => items.value[currentIndex.value])
const currentTemplate = computed(() =>
  screenManifests.find((template) => template.id === currentItem.value?.templateId),
)
const allFailed = computed(() =>
  items.value.length > 0 && failedTemplates.value.size >= items.value.length,
)

const syncState = () => {
  currentIndex.value = controller.index()
  paused.value = controller.isPaused()
}
const next = () => {
  controller.next()
  syncState()
}
const previous = () => {
  controller.previous()
  syncState()
}
const toggle = () => {
  controller.togglePaused()
  syncState()
}
const fullscreen = () => {
  if (document.fullscreenElement) void document.exitFullscreen()
  else void document.documentElement.requestFullscreen()
}
const exit = () => void router.push('/')

const onKeydown = (event: KeyboardEvent) => {
  if (event.code === 'Space') {
    event.preventDefault()
    toggle()
  } else if (event.key === 'ArrowRight') next()
  else if (event.key === 'ArrowLeft') previous()
  else if (event.key.toLowerCase() === 'f') fullscreen()
  else if (event.key === 'Escape') controlsVisible.value = false
}

const onVisibilityChange = () => {
  if (document.hidden) return
  controller.sync(Date.now())
  syncState()
}

onErrorCaptured(() => {
  const templateId = currentItem.value?.templateId
  if (templateId) {
    failedTemplates.value = new Set(failedTemplates.value).add(templateId)
  }
  window.clearTimeout(failureTimer)
  failureTimer = window.setTimeout(() => {
    controller.failCurrent()
    syncState()
  }, 5000)
  return false
})

onMounted(async () => {
  const mock = new URLSearchParams(window.location.search).get('mock') === '1'
  if (mock) {
    items.value = mockItems
  } else {
    const playlist = await apiRequest<{ items: PlaylistItem[] }>(
      `/api/big-screen/playlists/${props.playlistId}`,
    )
    items.value = playlist.items
  }
  controller = createPlaylistController(items.value)
  syncState()
  timer = window.setInterval(() => {
    controller.sync(Date.now())
    syncState()
  }, 1000)
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onUnmounted(() => {
  window.clearInterval(timer)
  window.clearTimeout(failureTimer)
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<template>
  <main v-if="allFailed" class="playlist-health">
    <p class="section-code">PLAYLIST / DEGRADED</p>
    <h1>所有模板暂时不可用</h1>
    <p>请检查数据源健康状态后重试。</p>
    <button type="button" @click="exit">返回模板目录</button>
  </main>
  <ScreenPlayer
    v-else-if="currentTemplate"
    :key="currentTemplate.id"
    :template="currentTemplate"
  />
  <main v-else class="playlist-health">
    <p>正在加载播放列表...</p>
  </main>

  <PlaylistPanel
    v-if="items.length"
    :items="items"
    :current-index="currentIndex"
    :paused="paused"
    :controls-visible="controlsVisible"
    @next="next"
    @previous="previous"
    @toggle="toggle"
    @fullscreen="fullscreen"
    @exit="exit"
  />
</template>

<style scoped>
.playlist-health {
  min-height: 100vh;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 16px;
  text-align: center;
}

.playlist-health h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 56px;
  font-weight: 500;
}
</style>
