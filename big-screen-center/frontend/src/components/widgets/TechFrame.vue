<script setup lang="ts">
import {
  BorderBox8,
  Decoration5,
  DigitalFlop,
} from '@kjgl77/datav-vue3'
import { computed, version as vueVersion } from 'vue'

const props = withDefaults(defineProps<{
  variant?: 'border-box' | 'decoration-line' | 'digital-title'
  title?: string
  value?: number
}>(), {
  variant: 'border-box',
  title: '',
  value: 0,
})

const digitalConfig = computed(() => ({
  number: [props.value],
  content: '{nt}',
  style: {
    fill: '#f3ead7',
    fontSize: 28,
    fontFamily: 'DIN Alternate',
  },
}))

const dataVCompatible = Number(vueVersion.split('.')[1]) < 5
</script>

<template>
  <BorderBox8
    v-if="dataVCompatible && variant === 'border-box'"
    class="tech-frame"
    :color="['#f2b84b', '#5a4b35']"
    :dur="6"
  >
    <slot />
  </BorderBox8>
  <div
    v-else-if="dataVCompatible && variant === 'decoration-line'"
    class="tech-frame tech-frame--line"
  >
    <span>{{ title }}</span>
    <Decoration5 :color="['#f2b84b', '#6a5a43']" :dur="4" />
    <slot />
  </div>
  <div
    v-else-if="dataVCompatible && variant === 'digital-title'"
    class="tech-frame tech-frame--digital"
  >
    <span>{{ title }}</span>
    <DigitalFlop :config="digitalConfig" />
    <slot />
  </div>
  <div
    v-else
    class="tech-frame tech-frame--fallback"
    :class="`tech-frame--fallback-${variant}`"
  >
    <span v-if="title" class="tech-frame__title">{{ title }}</span>
    <strong v-if="variant === 'digital-title'">{{ value.toLocaleString() }}</strong>
    <slot />
  </div>
</template>

<style scoped>
.tech-frame {
  width: 100%;
  height: 100%;
}

.tech-frame :deep(.border-box-content) {
  width: 100%;
  height: 100%;
}

.tech-frame--line,
.tech-frame--digital,
.tech-frame--fallback {
  position: relative;
  padding: 18px;
  border: 1px solid var(--screen-line);
}

.tech-frame--line > span,
.tech-frame--digital > span {
  color: var(--screen-muted);
  font-size: 10px;
  letter-spacing: 0.2em;
}

.tech-frame--line :deep(svg) {
  width: 100%;
  height: 28px;
}

.tech-frame--fallback {
  overflow: hidden;
  background:
    linear-gradient(90deg, var(--screen-accent), transparent) 0 0 / 42% 1px no-repeat,
    linear-gradient(180deg, var(--screen-accent), transparent) 0 0 / 1px 42% no-repeat,
    linear-gradient(270deg, var(--screen-accent), transparent) 100% 100% / 42% 1px no-repeat,
    linear-gradient(0deg, var(--screen-accent), transparent) 100% 100% / 1px 42% no-repeat,
    rgb(255 255 255 / 1.5%);
}

.tech-frame--fallback-decoration-line::after {
  content: "";
  position: absolute;
  left: 18px;
  top: 43px;
  width: calc(100% - 36px);
  height: 1px;
  background: linear-gradient(90deg, var(--screen-accent), transparent);
}

.tech-frame__title {
  display: block;
  color: var(--screen-muted);
  font-size: 10px;
  letter-spacing: 0.2em;
}
</style>
