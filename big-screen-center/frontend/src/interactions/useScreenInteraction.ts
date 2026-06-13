import {
  computed,
  inject,
  provide,
  ref,
  watch,
  type ComputedRef,
  type InjectionKey,
  type Ref,
} from 'vue'

import { metricLabel } from '../metric-labels'
import type {
  InteractionSnapshot,
  InteractionSource,
  InteractionTarget,
  JsonValue,
  ScreenTemplate,
  WidgetDefinition,
} from '../types'
import {
  createScreenInteractionController,
  type InteractionRelation,
} from './screen-interaction'

export interface ScreenInteractionApi {
  snapshot: Readonly<Ref<InteractionSnapshot>>
  active: ComputedRef<InteractionTarget | null>
  hover(target: InteractionTarget): void
  leave(): void
  lock(target: InteractionTarget): void
  clear(): void
  relationFor(key: string): InteractionRelation
  targetFor(
    widget: WidgetDefinition,
    key: string,
    value?: number | string,
    source?: InteractionSource,
  ): InteractionTarget
}

export const screenInteractionKey: InjectionKey<ScreenInteractionApi> =
  Symbol('screen-interaction')

const primitiveFilters = (filters: Record<string, JsonValue>) =>
  Object.fromEntries(
    Object.entries(filters).filter(
      (entry): entry is [string, string | number | boolean] =>
        ['string', 'number', 'boolean'].includes(typeof entry[1]),
    ),
  )

export const provideScreenInteraction = (
  template: Ref<ScreenTemplate>,
  data: Ref<JsonValue>,
  filters: Ref<Record<string, JsonValue>>,
): ScreenInteractionApi => {
  const snapshot = ref<InteractionSnapshot>({ hovered: null, locked: null })
  const controller = createScreenInteractionController((next) => {
    snapshot.value = next
  })
  const definitions = computed(() =>
    new Map(template.value.interactions.map((item) => [item.key, item])),
  )

  watch(data, (next) => controller.refresh(next), { deep: true })

  const api: ScreenInteractionApi = {
    snapshot,
    active: computed(() => snapshot.value.hovered || snapshot.value.locked),
    hover: controller.hover,
    leave: controller.leave,
    lock: controller.lock,
    clear: controller.clear,
    relationFor: controller.relationFor,
    targetFor(widget, key, value, source = 'metric-card') {
      const definition = definitions.value.get(key) || {
        key,
        label: metricLabel(key),
        group: 'other',
        relatedKeys: [],
        detailPath: '/',
        description: `${metricLabel(key)}的当前业务数据。`,
      }
      return {
        ...definition,
        value,
        unit: key.toLowerCase().includes('rate') ? '%' : undefined,
        source,
        sourceWidgetId: widget.id,
        templateId: template.value.id,
        filters: primitiveFilters(filters.value),
      }
    },
  }

  provide(screenInteractionKey, api)
  return api
}

export const useScreenInteraction = () => {
  const interaction = inject(screenInteractionKey)
  if (!interaction) {
    throw new Error('Screen interaction provider is missing')
  }
  return interaction
}
