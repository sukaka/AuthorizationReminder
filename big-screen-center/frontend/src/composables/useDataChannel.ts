import { onUnmounted, ref, shallowRef, watch, type Ref } from 'vue'

import { apiRequest } from '../api'
import { ApiError } from '../api'
import type {
  JsonValue,
  MetricEnvelope,
  RefreshMode,
  SystemKey,
} from '../types'

interface DataChannelOptions {
  systemKey: Ref<SystemKey>
  metricKey: Ref<string>
  filters: Ref<Record<string, JsonValue>>
  mode: Ref<RefreshMode>
  intervalMs: Ref<number>
  enabled?: Ref<boolean>
}

const queryString = (filters: Record<string, JsonValue>) => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value === null || value === undefined) continue
    if (Array.isArray(value)) {
      value.forEach((item) => params.append(key, String(item)))
    } else if (typeof value !== 'object') {
      params.set(key, String(value))
    }
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}

export function useDataChannel(options: DataChannelOptions) {
  const envelope = shallowRef<MetricEnvelope | null>(null)
  const state = ref<'idle' | 'loading' | 'live' | 'stale' | 'error'>('idle')
  const error = ref('')
  const errorStatusCode = ref<number | null>(null)
  let timer = 0
  let eventSource: EventSource | null = null

  const stop = () => {
    if (timer) window.clearInterval(timer)
    timer = 0
    eventSource?.close()
    eventSource = null
  }

  const dataPath = () =>
    `/api/big-screen/data/${options.systemKey.value}/${options.metricKey.value}${queryString(options.filters.value)}`

  const load = async () => {
    state.value = envelope.value ? state.value : 'loading'
    try {
      const next = await apiRequest<MetricEnvelope>(dataPath())
      envelope.value = next
      state.value = next.stale ? 'stale' : next.status === 'error' ? 'error' : 'live'
      error.value = ''
      errorStatusCode.value = null
    } catch (requestError) {
      state.value = 'error'
      error.value = requestError instanceof Error ? requestError.message : '大屏数据加载失败'
      errorStatusCode.value = requestError instanceof ApiError
        ? requestError.statusCode
        : null
    }
  }

  const startPolling = () => {
    void load()
    timer = window.setInterval(() => void load(), options.intervalMs.value)
  }

  const start = () => {
    stop()
    if (options.enabled?.value === false) {
      state.value = 'idle'
      error.value = ''
      errorStatusCode.value = null
      return
    }
    if (options.mode.value !== 'sse' || typeof EventSource === 'undefined') {
      startPolling()
      return
    }
    const streamPath = dataPath().replace('/data/', '/stream/')
    eventSource = new EventSource(streamPath, { withCredentials: true })
    eventSource.addEventListener('metric', (event) => {
      const next = JSON.parse((event as MessageEvent<string>).data) as MetricEnvelope
      envelope.value = next
      state.value = next.stale ? 'stale' : 'live'
      error.value = ''
    })
    eventSource.onerror = () => {
      stop()
      startPolling()
    }
  }

  watch(
    [
      options.systemKey,
      options.metricKey,
      options.mode,
      options.intervalMs,
      ...(options.enabled ? [options.enabled] : []),
      () => JSON.stringify(options.filters.value),
    ],
    start,
    { immediate: true },
  )
  onUnmounted(stop)

  return { envelope, state, error, errorStatusCode, refresh: load, stop }
}
