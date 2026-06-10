<script setup lang="ts">
import { computed, ref } from 'vue'

import { screenManifests } from '../templates/manifests'
import type { SystemKey } from '../types'

const systems: Array<{ key: SystemKey | 'all'; label: string; code: string }> = [
  { key: 'all', label: '全部模板', code: '00' },
  { key: 'sca', label: '软件成分分析', code: '05' },
  { key: 'train-exam', label: '培训考试', code: '04' },
  { key: 'reminder', label: '授权提醒', code: '03' },
]
const activeSystem = ref<SystemKey | 'all'>('all')
const visibleTemplates = computed(() =>
  activeSystem.value === 'all'
    ? screenManifests
    : screenManifests.filter((item) => item.systemKey === activeSystem.value),
)

const systemLabel = (key: SystemKey) =>
  systems.find((item) => item.key === key)?.label || key
</script>

<template>
  <main class="catalog">
    <header class="catalog__header">
      <div>
        <p class="section-code">CATALOG / 12</p>
        <h1>选择一个视角，<br class="desktop-break">让系统开始叙事。</h1>
      </div>
      <p class="catalog__brief">
        三个业务系统，共十二套成品大屏。每套提供 16:9 与超宽布局，
        数据权限始终跟随统一登录。
      </p>
    </header>

    <nav class="system-index" aria-label="业务系统筛选">
      <button
        v-for="system in systems"
        :key="system.key"
        type="button"
        :class="{ active: activeSystem === system.key }"
        @click="activeSystem = system.key"
      >
        <span>{{ system.code }}</span>
        {{ system.label }}
      </button>
    </nav>

    <section class="template-list" aria-live="polite">
      <article
        v-for="(template, index) in visibleTemplates"
        :key="template.id"
        class="template-row"
      >
        <span class="template-row__number">{{ String(index + 1).padStart(2, '0') }}</span>
        <div class="template-row__identity">
          <small>{{ systemLabel(template.systemKey) }} / {{ template.id }}</small>
          <h2>{{ template.name }}</h2>
        </div>
        <div class="template-row__meta">
          <span>{{ template.layouts.widescreen.width }} × {{ template.layouts.widescreen.height }}</span>
          <span>{{ template.effectsProfile.toUpperCase() }}</span>
          <span>{{ template.refreshPolicy.mode.toUpperCase() }}</span>
        </div>
        <RouterLink :to="`/play/${template.id}`">进入预览</RouterLink>
      </article>
    </section>
  </main>
</template>
