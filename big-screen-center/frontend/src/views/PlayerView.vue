<script setup lang="ts">
import { computed } from 'vue'

import ScreenPlayer from '../components/ScreenPlayer.vue'
import { screenManifests } from '../templates/manifests'

const props = defineProps<{
  templateId: string
}>()

const template = computed(() =>
  screenManifests.find((candidate) => candidate.id === props.templateId),
)
</script>

<template>
  <ScreenPlayer v-if="template" :template="template" />
  <main v-else class="route-placeholder">
    <p class="section-code">PLAYER / 404</p>
    <h1>未找到大屏模板</h1>
    <p>模板 {{ templateId }} 不在本地发布目录中。</p>
    <RouterLink to="/">返回模板目录</RouterLink>
  </main>
</template>
