import type { JsonValue, SystemKey } from './types'

export const previewData: Record<SystemKey, Record<string, JsonValue>> = {
  sca: {
    totalProjects: 6631,
    criticalRisks: 48,
    vulnerableComponents: 1276,
    healthyRate: 86,
    high: 48,
    medium: 179,
    low: 463,
  },
  'train-exam': {
    activeCourses: 128,
    learners: 8426,
    completionRate: 91,
    certificates: 3268,
    mandatory: 96,
    elective: 72,
    overdue: 17,
  },
  reminder: {
    expiring7d: 42,
    expiring30d: 186,
    riskAmount: 2680,
    deliveryRate: 94,
    day7: 42,
    day30: 186,
    day60: 324,
    day90: 491,
  },
}

export const isLocalPreviewHost = (hostname: string) =>
  hostname === 'localhost'
  || hostname === '127.0.0.1'
  || hostname === '::1'

export const shouldUseLocalPreviewFallback = ({
  hostname,
  isMock,
  hasEnvelope,
  state,
}: {
  hostname: string
  isMock: boolean
  hasEnvelope: boolean
  state: 'idle' | 'loading' | 'live' | 'stale' | 'error'
}) => !isMock && !hasEnvelope && state === 'error' && isLocalPreviewHost(hostname)
