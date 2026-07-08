<script setup lang="ts">
import { computed } from 'vue'

import {
  buildBusinessDetailUrl,
  openBusinessDetail,
  type BusinessDetailOpener,
} from '../interactions/business-navigation'
import type {
  InteractionTarget,
  MetricInteractionDefinition,
  SystemKey,
} from '../types'

type RelatedMetric = MetricInteractionDefinition & {
  value?: number | string
  unit?: string
}

const props = defineProps<{
  target: InteractionTarget | null
  related: RelatedMetric[]
  systemKey: SystemKey
  currentHref?: string
  opener?: BusinessDetailOpener
}>()

defineEmits<{
  close: []
}>()

const currentHref = computed(() =>
  props.currentHref
  || (typeof window !== 'undefined' ? window.location.href : '/'),
)

const detailUrl = computed(() => {
  if (!props.target) return null
  try {
    return buildBusinessDetailUrl({
      systemKey: props.systemKey,
      detailPath: props.target.detailPath,
      currentHref: currentHref.value,
      context: {
        metric: props.target.key,
        ...props.target.filters,
      },
    })
  } catch {
    return null
  }
})

const openDetail = () => {
  if (!props.target || !detailUrl.value) return
  openBusinessDetail(
    {
      systemKey: props.systemKey,
      detailPath: props.target.detailPath,
      currentHref: currentHref.value,
      context: {
        metric: props.target.key,
        ...props.target.filters,
      },
    },
    props.opener,
  )
}
</script>

<template>
  <Transition name="interaction-console">
    <aside
      v-if="target"
      class="interaction-console interaction-console--light"
      data-interaction-console
      aria-live="polite"
      @click.stop
    >
      <section class="interaction-console__metric">
        <span>当前指标</span>
        <strong>{{ target.label }}</strong>
        <b>{{ target.value ?? '暂无' }}{{ target.unit || '' }}</b>
      </section>

      <section class="interaction-console__description">
        <span>指标说明</span>
        <p>{{ target.description }}</p>
      </section>

      <section class="interaction-console__related">
        <span>关联指标</span>
        <p v-if="related.length">
          <em v-for="item in related" :key="item.key">
            {{ item.label }}：{{ item.value ?? '暂无' }}{{ item.unit || '' }}
          </em>
        </p>
        <p v-else>暂无关联指标</p>
      </section>

      <nav class="interaction-console__actions" aria-label="联动分析台操作">
        <button
          v-if="detailUrl"
          type="button"
          data-business-detail
          @click="openDetail"
        >
          前往业务系统
        </button>
        <button
          type="button"
          aria-label="关闭联动分析台"
          @click="$emit('close')"
        >
          关闭
        </button>
      </nav>
    </aside>
  </Transition>
</template>

<style scoped>
.interaction-console {
  position: absolute;
  right: 52px;
  bottom: 30px;
  left: 52px;
  z-index: 5;
  display: grid;
  min-height: 150px;
  grid-template-columns: 260px minmax(0, 1.2fr) minmax(0, 1fr) auto;
  gap: 22px;
  align-items: center;
  padding: 20px 24px;
  color: var(--screen-text);
  background: var(--screen-surface-solid);
  border: 1px solid var(--screen-accent);
  box-shadow: 0 -12px 42px var(--screen-shadow);
  backdrop-filter: blur(14px);
}

.interaction-console span {
  display: block;
  margin-bottom: 8px;
  color: var(--screen-muted);
  font-size: 10px;
  letter-spacing: 0.18em;
}

.interaction-console strong,
.interaction-console b {
  display: block;
  font-family: var(--font-display);
  font-weight: 500;
}

.interaction-console strong {
  font-size: 28px;
}

.interaction-console b {
  margin-top: 8px;
  color: var(--screen-accent);
  font-size: 24px;
}

.interaction-console p {
  margin: 0;
  color: var(--screen-text);
  font-size: 13px;
  line-height: 1.8;
}

.interaction-console__related p {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.interaction-console em {
  padding: 4px 8px;
  font-style: normal;
  background: color-mix(in srgb, var(--screen-accent), white 92%);
  border: 1px solid var(--screen-line);
}

.interaction-console__actions {
  display: grid;
  gap: 10px;
}

.interaction-console button {
  min-width: 112px;
  padding: 9px 14px;
  color: #ffffff;
  background: var(--screen-accent);
  border: 0;
  cursor: pointer;
  font: inherit;
}

.interaction-console button:last-child {
  color: var(--screen-text);
  background: transparent;
  border: 1px solid var(--screen-line);
}

.interaction-console-enter-active,
.interaction-console-leave-active {
  transition:
    opacity 320ms ease,
    transform 320ms ease;
}

.interaction-console-enter-from,
.interaction-console-leave-to {
  opacity: 0;
  transform: translateY(24px);
}

:global([data-screen-layout="ultrawide"]) .interaction-console {
  min-height: 190px;
  grid-template-columns: 360px 1.4fr 1.2fr auto;
}

@media (prefers-reduced-motion: reduce) {
  .interaction-console-enter-active,
  .interaction-console-leave-active {
    transition-duration: 0.01ms;
  }

  .interaction-console-enter-from,
  .interaction-console-leave-to {
    transform: none;
  }
}
</style>
