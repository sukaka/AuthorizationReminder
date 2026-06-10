<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue'

import { resolveWidgetLoader } from '../../registry/widgets'
import type {
  EffectsProfile,
  JsonValue,
  WidgetDefinition,
} from '../../types'

const props = defineProps<{
  widget: WidgetDefinition
  data: JsonValue
  performanceProfile: EffectsProfile
}>()

const widgetComponent = computed(() => {
  const loader = resolveWidgetLoader(props.widget.type)
  return loader ? defineAsyncComponent(loader) : null
})
</script>

<template>
  <component
    :is="widgetComponent"
    v-if="widgetComponent"
    :widget="widget"
    :data="data"
    :performance-profile="performanceProfile"
  />
  <section v-else class="widget-error" role="alert">
    <span>REGISTRY / 404</span>
    <strong>未注册组件</strong>
    <p>组件类型“{{ widget.type }}”不在本地白名单中，已阻止加载。</p>
  </section>
</template>

<style scoped>
.widget-error {
  min-height: 120px;
  padding: 18px;
  color: var(--danger-ink);
  background: var(--danger-surface);
  border: 1px dashed var(--danger-line);
}

.widget-error span {
  display: block;
  margin-bottom: 18px;
  font-size: 10px;
  letter-spacing: 0.2em;
}

.widget-error strong {
  display: block;
  font-size: 18px;
}

.widget-error p {
  margin: 8px 0 0;
  color: color-mix(in oklch, var(--danger-ink), transparent 28%);
}
</style>
