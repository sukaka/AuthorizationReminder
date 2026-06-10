<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'

import ScreenEditor from '../components/ScreenEditor.vue'
import { screenManifests } from '../templates/manifests'

const props = defineProps<{
  templateId: string
}>()
const router = useRouter()

const template = computed(() =>
  screenManifests.find((candidate) => candidate.id === props.templateId),
)

onMounted(() => {
  if (window.innerWidth < 768) {
    void router.replace({ path: '/', query: { notice: 'desktop-editor' } })
  }
})
</script>

<template>
  <ScreenEditor v-if="template" :template="template" />
  <main v-else class="route-placeholder">
    <p class="section-code">EDITOR / 404</p>
    <h1>未找到编辑模板</h1>
    <RouterLink to="/">返回模板目录</RouterLink>
  </main>
</template>
