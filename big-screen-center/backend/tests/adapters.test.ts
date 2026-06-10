import { describe, expect, it, vi } from 'vitest'

import { MetricCache, MetricService } from '../src/cache.js'
import { CircuitBreaker, CircuitOpenError } from '../src/circuit-breaker.js'
import { createReminderAdapter } from '../src/adapters/reminder.js'
import { createScaAdapter } from '../src/adapters/sca.js'
import { createTrainExamAdapter } from '../src/adapters/train-exam.js'
import type { MetricAdapter } from '../src/adapters/types.js'

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })

describe('metric adapters', () => {
  it('forwards auth context, uses only approved SCA endpoints, and masks sensitive values', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.endsWith('/api/sca/overview')) {
        return jsonResponse({ project_count: 2, contact_name: '张三' })
      }
      if (url.endsWith('/api/sca/assets/dashboard')) {
        return jsonResponse({ component_total: 9, phone: '13812345678' })
      }
      if (url.endsWith('/api/sca/dependency-check/status')) {
        return jsonResponse({ enabled: true, email: 'owner@example.com' })
      }
      return jsonResponse({ total: 4, blocked_count: 1 })
    })
    const adapter = createScaAdapter({
      baseUrl: 'http://sca-api:5191',
      fetchImpl,
    })

    const envelope = await adapter.getMetric(
      'security-overview',
      {},
      {
        cookie: 'juxin_auth_token=test',
        authorization: 'Bearer session-token',
        requestId: 'request-7',
      },
    )

    expect(envelope.status).toBe('ok')
    expect(envelope.systemKey).toBe('sca')
    expect(envelope.data).toMatchObject({
      overview: { contact_name: '张**' },
      assets: { phone: '138****5678' },
      dependencyCheck: { email: 'o***@example.com' },
    })
    expect(calls.map((item) => new URL(item.url).pathname)).toEqual([
      '/api/sca/overview',
      '/api/sca/assets/dashboard',
      '/api/sca/dependency-check/status',
      '/api/sca/devops/dashboard',
    ])
    for (const call of calls) {
      expect(call.init?.headers).toMatchObject({
        Cookie: 'juxin_auth_token=test',
        Authorization: 'Bearer session-token',
        'X-Request-Id': 'request-7',
      })
    }
  })

  it('coalesces concurrent identical requests', async () => {
    let calls = 0
    const source: MetricAdapter = {
      systemKey: 'sca',
      async getMetric(systemMetric) {
        calls += 1
        await new Promise((resolve) => setTimeout(resolve, 20))
        return {
          schemaVersion: '1.0',
          systemKey: 'sca',
          metricKey: systemMetric,
          generatedAt: new Date().toISOString(),
          sourceUpdatedAt: null,
          stale: false,
          status: 'ok',
          data: { total: 1 },
          unavailableSources: [],
        }
      },
    }
    const service = new MetricService({
      adapters: [source],
      cache: new MetricCache(),
    })

    await Promise.all(
      Array.from({ length: 20 }, () =>
        service.getMetric('sca', 'security-overview', {}, {}),
      ),
    )

    expect(calls).toBe(1)
  })

  it('uses only approved training and reminder aggregate endpoints', async () => {
    const trainingPaths: string[] = []
    const reminderPaths: string[] = []
    const training = createTrainExamAdapter({
      baseUrl: 'http://train-exam-api:5188',
      fetchImpl: vi.fn(async (input) => {
        trainingPaths.push(new URL(String(input)).pathname + new URL(String(input)).search)
        return jsonResponse({})
      }),
    })
    const reminder = createReminderAdapter({
      baseUrl: 'http://api:5179',
      fetchImpl: vi.fn(async (input) => {
        reminderPaths.push(new URL(String(input)).pathname)
        return jsonResponse({})
      }),
    })

    await training.getMetric('training-outcomes', {}, {})
    await reminder.getMetric('customer-sales', {}, {})

    expect(trainingPaths).toEqual([
      '/api/train-exam/stats/overview',
      '/api/train-exam/stats/pass-trend?days=30',
      '/api/train-exam/stats/org-breakdown',
    ])
    expect(reminderPaths).toEqual([
      '/api/dashboard',
      '/api/sales-license-overview',
    ])
  })

  it('does not share scoped metric responses between users', async () => {
    let calls = 0
    const source: MetricAdapter = {
      systemKey: 'sca',
      async getMetric(systemMetric, _filters, context) {
        calls += 1
        return {
          schemaVersion: '1.0',
          systemKey: 'sca',
          metricKey: systemMetric,
          generatedAt: new Date().toISOString(),
          sourceUpdatedAt: null,
          stale: false,
          status: 'ok',
          data: { scope: context.cacheScope || '' },
          unavailableSources: [],
        }
      },
    }
    const service = new MetricService({
      adapters: [source],
      cache: new MetricCache(),
    })

    const first = await service.getMetric(
      'sca',
      'security-overview',
      {},
      { cacheScope: 'user:7' },
    )
    const second = await service.getMetric(
      'sca',
      'security-overview',
      {},
      { cacheScope: 'user:8' },
    )

    expect(calls).toBe(2)
    expect(first.data).toEqual({ scope: 'user:7' })
    expect(second.data).toEqual({ scope: 'user:8' })
  })

  it('keeps a fresh upstream response when snapshot persistence fails', async () => {
    const source: MetricAdapter = {
      systemKey: 'sca',
      async getMetric(systemMetric) {
        return {
          schemaVersion: '1.0',
          systemKey: 'sca',
          metricKey: systemMetric,
          generatedAt: new Date().toISOString(),
          sourceUpdatedAt: null,
          stale: false,
          status: 'ok',
          data: { total: 3 },
          unavailableSources: [],
        }
      },
    }
    const service = new MetricService({
      adapters: [source],
      cache: new MetricCache(),
      snapshots: {
        async save() {
          throw new Error('mysql unavailable')
        },
        async load() {
          return null
        },
      },
    })

    const response = await service.getMetric('sca', 'security-overview', {}, {})

    expect(response.status).toBe('ok')
    expect(response.stale).toBe(false)
    expect(response.data).toEqual({ total: 3 })
  })
})

describe('CircuitBreaker', () => {
  it('opens after five failures and allows one half-open probe', async () => {
    let now = 1_000
    const breaker = new CircuitBreaker({
      failureThreshold: 5,
      openMs: 30_000,
      now: () => now,
    })
    const failure = () => Promise.reject(new Error('upstream failed'))

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(breaker.execute(failure)).rejects.toThrow('upstream failed')
    }
    await expect(breaker.execute(failure)).rejects.toBeInstanceOf(CircuitOpenError)

    now += 30_001
    await expect(breaker.execute(async () => 'ok')).resolves.toBe('ok')
    await expect(breaker.execute(async () => 'again')).resolves.toBe('again')
  })
})
