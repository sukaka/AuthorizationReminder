<script setup lang="ts">
import { GridStack, type GridStackNode } from 'gridstack'
import 'gridstack/dist/gridstack.min.css'
import { onMounted, onUnmounted, ref } from 'vue'

import { apiRequest } from '../api'
import {
  applyEdit,
  createEditorState,
  serializeEditorState,
} from '../editor'
import type { EffectsProfile, ScreenTemplate } from '../types'

const props = defineProps<{
  template: ScreenTemplate
}>()

const gridHost = ref<HTMLElement | null>(null)
const state = ref(createEditorState(props.template))
const status = ref('')
let grid: GridStack | null = null

const applyGridChanges = (_event: Event, nodes: GridStackNode[]) => {
  for (const node of nodes) {
    const widgetId = node.el?.dataset.widgetId
    if (!widgetId) continue
    if (node.x !== undefined && node.y !== undefined) {
      state.value = applyEdit(props.template, state.value, {
        type: 'set-position',
        widgetId,
        layout: 'widescreen',
        area: props.template.widgets.find((widget) => widget.id === widgetId)?.layoutArea || '',
        x: node.x,
        y: node.y,
      })
    }
    if (node.w !== undefined && node.h !== undefined) {
      state.value = applyEdit(props.template, state.value, {
        type: 'set-size',
        widgetId,
        layout: 'widescreen',
        width: node.w,
        height: node.h,
      })
    }
  }
}

onMounted(() => {
  if (!gridHost.value) return
  grid = GridStack.init({
    column: 12,
    cellHeight: 58,
    float: true,
    margin: 10,
  }, gridHost.value)
  grid.on('change', applyGridChanges)
})
onUnmounted(() => grid?.destroy(false))

const setEffects = (profile: EffectsProfile) => {
  state.value = applyEdit(props.template, state.value, {
    type: 'set-effects',
    profile,
  })
}

const toggleWidget = (widgetId: string, hidden: boolean) => {
  state.value = applyEdit(props.template, state.value, {
    type: 'set-hidden',
    widgetId,
    hidden,
  })
}

const saveDraft = async () => {
  status.value = '正在保存草稿...'
  await apiRequest(`/api/big-screen/templates/${props.template.id}/draft`, {
    method: 'PUT',
    body: JSON.stringify({ config: serializeEditorState(state.value) }),
  })
  status.value = '草稿已保存'
}

const publish = async () => {
  await saveDraft()
  const result = await apiRequest<{ version: number }>(
    `/api/big-screen/templates/${props.template.id}/publish`,
    { method: 'POST' },
  )
  status.value = `已发布版本 ${result.version}`
}

const restoreDefault = async () => {
  const result = await apiRequest<{ config: unknown }>(
    `/api/big-screen/templates/${props.template.id}/restore-default`,
    { method: 'POST' },
  )
  state.value = createEditorState(props.template)
  status.value = result.config ? '已恢复默认配置' : '恢复失败'
}
</script>

<template>
  <main class="screen-editor">
    <header class="screen-editor__header">
      <div>
        <p class="section-code">EDITOR / {{ template.id }}</p>
        <h1>{{ template.name }}</h1>
      </div>
      <div class="screen-editor__actions">
        <label>
          特效等级
          <select
            :value="state.effectsProfile"
            @change="setEffects(($event.target as HTMLSelectElement).value as EffectsProfile)"
          >
            <option value="high">高</option>
            <option value="medium">中</option>
            <option value="low">低</option>
          </select>
        </label>
        <button type="button" @click="restoreDefault">恢复默认</button>
        <button type="button" @click="saveDraft">保存草稿</button>
        <button class="primary" type="button" @click="publish">发布新版本</button>
      </div>
    </header>

    <p class="screen-editor__status" aria-live="polite">{{ status }}</p>

    <section ref="gridHost" class="grid-stack screen-editor__grid">
      <article
        v-for="widget in template.widgets"
        :key="widget.id"
        class="grid-stack-item"
        :data-widget-id="widget.id"
        :gs-w="state.widgets[widget.id]?.layouts.widescreen.width"
        :gs-h="state.widgets[widget.id]?.layouts.widescreen.height"
        :gs-min-w="widget.minWidth"
        :gs-min-h="widget.minHeight"
        :gs-max-w="widget.maxWidth"
        :gs-max-h="widget.maxHeight"
      >
        <div class="grid-stack-item-content">
          <span>{{ widget.layoutArea }}</span>
          <strong>{{ widget.type }}</strong>
          <label v-if="widget.optional">
            <input
              type="checkbox"
              :checked="!state.widgets[widget.id]?.hidden"
              @change="toggleWidget(widget.id, !($event.target as HTMLInputElement).checked)"
            >
            显示
          </label>
          <small v-else>核心组件 · 不可隐藏</small>
        </div>
      </article>
    </section>
  </main>
</template>

<style scoped>
.screen-editor {
  min-height: 100vh;
  padding: 54px clamp(28px, 5vw, 80px) 80px;
}

.screen-editor__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 32px;
  margin-bottom: 20px;
}

.screen-editor h1 {
  margin: 10px 0 0;
  font-family: var(--font-display);
  font-size: 52px;
  font-weight: 500;
}

.screen-editor__actions {
  display: flex;
  align-items: end;
  gap: 12px;
}

.screen-editor__actions label {
  display: grid;
  gap: 6px;
  color: var(--ink-muted);
  font-size: 11px;
}

button,
select {
  min-height: 40px;
  padding: 0 14px;
  color: var(--ink-strong);
  background: var(--surface-raised);
  border: 1px solid var(--line-strong);
}

button {
  cursor: pointer;
}

button.primary {
  color: var(--canvas);
  background: var(--accent-warm);
}

.screen-editor__status {
  min-height: 22px;
  color: var(--accent-signal);
}

.screen-editor__grid {
  min-height: 680px;
  background:
    linear-gradient(90deg, var(--line-soft) 1px, transparent 1px) 0 0 / 64px 64px,
    linear-gradient(var(--line-soft) 1px, transparent 1px) 0 0 / 64px 64px,
    var(--surface);
  border: 1px solid var(--line-strong);
}

.grid-stack-item-content {
  display: grid;
  align-content: space-between;
  padding: 18px;
  overflow: hidden;
  background: var(--surface-raised);
  border: 1px solid var(--line-strong);
}

.grid-stack-item-content span {
  color: var(--accent-warm);
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.grid-stack-item-content strong {
  font-family: var(--font-display);
  font-size: 20px;
  text-transform: uppercase;
}

.grid-stack-item-content small,
.grid-stack-item-content label {
  color: var(--ink-muted);
  font-size: 11px;
}
</style>
