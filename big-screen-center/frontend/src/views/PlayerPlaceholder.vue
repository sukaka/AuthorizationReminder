<script setup lang="ts">
defineProps<{
  templateId: string
}>()
</script>

<template>
  <main class="route-placeholder">
    <p class="section-code">PLAYER / {{ templateId }}</p>
    <h1>播放器正在装配</h1>
    <p>当前阶段已完成双布局、性能分级和安全组件注册。</p>
    <RouterLink to="/">返回模板目录</RouterLink>
  </main>
</template>
