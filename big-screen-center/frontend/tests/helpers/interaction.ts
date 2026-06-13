import { mount, type ComponentMountingOptions } from '@vue/test-utils'
import { computed, ref, type Component } from 'vue'

import { metricLabel } from '../../src/metric-labels'
import {
  screenInteractionKey,
  type ScreenInteractionApi,
} from '../../src/interactions/useScreenInteraction'
import type {
  InteractionTarget,
  WidgetDefinition,
} from '../../src/types'

export const mountWithInteraction = (
  component: Component,
  props: Record<string, unknown>,
  options: ComponentMountingOptions<Component> = {},
) => {
  const snapshot = ref({
    hovered: null,
    locked: null,
  } as {
    hovered: InteractionTarget | null
    locked: InteractionTarget | null
  })
  const active = computed(() => snapshot.value.hovered || snapshot.value.locked)

  const api: ScreenInteractionApi = {
    snapshot,
    active,
    hover(target) {
      snapshot.value = { ...snapshot.value, hovered: target }
    },
    leave() {
      snapshot.value = { ...snapshot.value, hovered: null }
    },
    lock(target) {
      snapshot.value = { hovered: null, locked: target }
    },
    clear() {
      snapshot.value = { hovered: null, locked: null }
    },
    relationFor(key) {
      if (active.value?.key === key) return 'primary'
      if (active.value?.relatedKeys.includes(key)) return 'related'
      return 'none'
    },
    targetFor(widget: WidgetDefinition, key, value, source = 'metric-card') {
      return {
        key,
        label: metricLabel(key),
        group: 'test',
        relatedKeys: [],
        detailPath: '/',
        description: `${metricLabel(key)}测试说明`,
        value,
        source,
        sourceWidgetId: widget.id,
        templateId: 'sca-01',
        filters: {},
      }
    },
  }

  const wrapper = mount(component, {
    ...options,
    props,
    global: {
      ...options.global,
      provide: {
        ...options.global?.provide,
        [screenInteractionKey as symbol]: api,
      },
    },
  })

  return { wrapper, api }
}
