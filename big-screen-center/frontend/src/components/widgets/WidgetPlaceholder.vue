<script setup lang="ts">
import type { EffectsProfile, JsonValue, WidgetDefinition } from '../../types'

defineProps<{
  widget: WidgetDefinition
  data: JsonValue
  performanceProfile: EffectsProfile
}>()
</script>

<template>
  <section class="widget-placeholder" :data-widget-type="widget.type">
    <span class="widget-placeholder__index">{{ widget.layoutArea }}</span>
    <strong>{{ widget.type }}</strong>
    <small>{{ performanceProfile }} profile</small>
  </section>
</template>

<style scoped>
.widget-placeholder {
  min-height: 120px;
  display: grid;
  grid-template-columns: 1fr auto;
  align-content: space-between;
  gap: 12px;
  padding: 18px;
  color: var(--ink-strong);
  background:
    linear-gradient(90deg, var(--line-soft) 1px, transparent 1px) 0 0 / 24px 24px,
    var(--surface-raised);
  border: 1px solid var(--line-strong);
}

.widget-placeholder__index {
  color: var(--accent-warm);
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

strong {
  align-self: end;
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 600;
  text-transform: uppercase;
}

small {
  align-self: end;
  color: var(--ink-muted);
}
</style>
