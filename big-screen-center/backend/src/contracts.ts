import { z } from 'zod'

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export const SystemKeySchema = z.enum(['sca', 'train-exam', 'reminder'])
export const EffectsProfileSchema = z.enum(['high', 'medium', 'low'])
export const DataStatusSchema = z.enum(['ok', 'partial', 'stale', 'empty', 'error'])
export const RegisteredWidgetTypeSchema = z.enum([
  'metric-cards',
  'echart',
  'three-scene',
  'graph',
  'map',
  'status-matrix',
  'ranking-table',
])

const forbiddenConfigKey = /^(script|html|sql|url|src|href|endpoint)$/i
const forbiddenConfigStringPatterns = [
  { pattern: /<\/?[a-z][^>]*>/i, label: 'HTML' },
  {
    pattern: /\b(?:select\s+.+\s+from|insert\s+into|update\s+.+\s+set|delete\s+from|drop\s+(?:table|database)|alter\s+table)\b/is,
    label: 'SQL',
  },
  { pattern: /(?:https?:\/\/|^\/\/)/i, label: 'remote URL' },
  { pattern: /\bjavascript\s*:/i, label: 'script protocol' },
  { pattern: /(?:=>|\bfunction\s*\(|\beval\s*\()/i, label: 'executable function' },
]

const SafeStringSchema = z.string().superRefine((value, context) => {
  for (const { pattern, label } of forbiddenConfigStringPatterns) {
    if (pattern.test(value)) {
      context.addIssue({
        code: 'custom',
        message: `Forbidden ${label} content in widget config`,
      })
    }
  }
})

const JsonPrimitiveSchema = z.union([
  SafeStringSchema,
  z.number(),
  z.boolean(),
  z.null(),
])

export const SafeJsonSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z
    .union([
      JsonPrimitiveSchema,
      z.array(SafeJsonSchema),
      z.record(z.string(), SafeJsonSchema),
    ])
    .superRefine((value, context) => {
      if (!value || Array.isArray(value) || typeof value !== 'object') return

      for (const key of Object.keys(value)) {
        if (forbiddenConfigKey.test(key)) {
          context.addIssue({
            code: 'custom',
            message: `Forbidden config key: ${key}`,
          })
        }
      }
    }),
)

export const LayoutSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  areas: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)).min(1),
})

export const WidgetSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    type: RegisteredWidgetTypeSchema,
    dataSourceKey: z.string().regex(/^[a-z0-9-]+$/),
    layoutArea: z.string().regex(/^[a-z][a-z0-9-]*$/),
    optional: z.boolean(),
    minWidth: z.number().int().positive(),
    minHeight: z.number().int().positive(),
    maxWidth: z.number().int().positive(),
    maxHeight: z.number().int().positive(),
    config: SafeJsonSchema,
  })
  .refine(
    (value) => value.minWidth <= value.maxWidth && value.minHeight <= value.maxHeight,
    { message: 'Widget min size must not exceed max size' },
  )

export const ScreenTemplateSchema = z
  .object({
    id: z.string().regex(/^(sca|train|remind)-0[1-9]$/),
    systemKey: SystemKeySchema,
    name: z.string().min(2).max(40),
    version: z.number().int().positive(),
    themeKey: z.string().regex(/^[a-z0-9-]+$/),
    effectsProfile: EffectsProfileSchema,
    layouts: z.object({
      widescreen: LayoutSchema,
      ultrawide: LayoutSchema,
    }),
    widgets: z.array(WidgetSchema).min(4),
    filters: z.array(
      z.object({
        key: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
        type: z.enum(['date-range', 'select', 'multi-select']),
        required: z.boolean(),
      }),
    ),
    refreshPolicy: z.object({
      mode: z.enum(['poll', 'sse', 'manual']),
      intervalMs: z.number().int().min(5000).max(600000),
    }),
  })
  .superRefine((template, context) => {
    const expectedPrefix = {
      sca: 'sca-',
      'train-exam': 'train-',
      reminder: 'remind-',
    }[template.systemKey]
    const widescreenAreas = new Set(template.layouts.widescreen.areas)
    const ultrawideAreas = new Set(template.layouts.ultrawide.areas)

    if (!template.id.startsWith(expectedPrefix)) {
      context.addIssue({
        code: 'custom',
        message: 'Template id prefix must match system key',
        path: ['id'],
      })
    }

    if (template.widgets.filter((widget) => widget.type === 'three-scene').length > 1) {
      context.addIssue({
        code: 'custom',
        message: 'Template may contain at most one Three.js scene',
        path: ['widgets'],
      })
    }

    template.widgets.forEach((widget, index) => {
      if (!widescreenAreas.has(widget.layoutArea) || !ultrawideAreas.has(widget.layoutArea)) {
        context.addIssue({
          code: 'custom',
          message: 'Widget layout area must exist in both layouts',
          path: ['widgets', index, 'layoutArea'],
        })
      }
    })
  })

export type ScreenTemplate = z.infer<typeof ScreenTemplateSchema>
export type SystemKey = z.infer<typeof SystemKeySchema>
export type DataStatus = z.infer<typeof DataStatusSchema>

export interface MetricEnvelope<T = unknown> {
  schemaVersion: '1.0'
  systemKey: SystemKey
  metricKey: string
  generatedAt: string
  sourceUpdatedAt: string | null
  stale: boolean
  status: DataStatus
  data: T
  unavailableSources: string[]
}
