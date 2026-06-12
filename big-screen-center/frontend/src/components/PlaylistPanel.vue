<script setup lang="ts">
import type { PlaylistItem } from '../playlist'

defineProps<{
  items: PlaylistItem[]
  currentIndex: number
  paused: boolean
  controlsVisible: boolean
}>()

defineEmits<{
  next: []
  previous: []
  toggle: []
  fullscreen: []
  exit: []
}>()
</script>

<template>
  <aside
    v-show="controlsVisible"
    class="playlist-panel"
    data-mobile-playback-controls
  >
    <div>
      <span>播放清单 / 第 {{ currentIndex + 1 }} 项 / 共 {{ items.length }} 项</span>
      <strong>{{ items[currentIndex]?.templateId }}</strong>
    </div>
    <div class="playlist-panel__controls">
      <button type="button" aria-label="上一项" @click="$emit('previous')">←</button>
      <button type="button" @click="$emit('toggle')">
        {{ paused ? '恢复' : '暂停' }}
      </button>
      <button type="button" aria-label="下一项" @click="$emit('next')">→</button>
      <button type="button" class="desktop-control" @click="$emit('fullscreen')">
        全屏
      </button>
      <button type="button" @click="$emit('exit')">退出</button>
    </div>
  </aside>
</template>

<style scoped>
.playlist-panel {
  position: fixed;
  z-index: 200;
  left: 50%;
  bottom: 24px;
  width: min(760px, calc(100vw - 40px));
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 15px 18px;
  color: #f4ead7;
  background: rgb(19 16 12 / 92%);
  border: 1px solid rgb(242 184 75 / 38%);
  backdrop-filter: blur(14px);
  transform: translateX(-50%);
}

.playlist-panel span,
.playlist-panel strong {
  display: block;
}

.playlist-panel span {
  color: #aa9b83;
  font-size: 9px;
  letter-spacing: 0.16em;
}

.playlist-panel strong {
  margin-top: 5px;
  font-family: var(--font-display);
  font-size: 19px;
  font-weight: 500;
  text-transform: uppercase;
}

.playlist-panel__controls {
  display: flex;
  gap: 8px;
}

button {
  min-height: 38px;
  padding: 0 13px;
  color: #f4ead7;
  background: #2a241c;
  border: 1px solid rgb(244 234 215 / 18%);
  cursor: pointer;
}

@media (max-width: 767px) {
  .playlist-panel {
    bottom: 12px;
    align-items: stretch;
    flex-direction: column;
    gap: 12px;
  }

  .playlist-panel__controls {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
  }

  .desktop-control {
    display: none;
  }
}
</style>
