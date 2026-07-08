import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { MetricCache, MetricService, metricCacheKey } from '../src/cache.js'
import type { MetricAdapter } from '../src/adapters/types.js'
import type { MetricEnvelope } from '../src/contracts.js'

describe('big-screen data route', () => {
  it('exposes a lightweight auth check for protected screen entries', async () => {
    const app = createApp({
      authorize: async () => ({
        user: { id: 7, username: 'viewer', role: 'user' },
        apps: ['big-screen', 'sca'],
        allowedSystems: ['sca'],
        screenRole: 'viewer',
        scope: {},
      }),
    })

    const response = await request(app)
      .get('/api/big-screen/auth/check')
      .set('Cookie', 'juxin_auth_token=test')

    expect(response.status).toBe(204)
    expect(response.text).toBe('')
  })

  it('rejects the auth check when unified login is missing', async () => {
    const app = createApp({
      authorize: async () => {
        throw Object.assign(new Error('请先登录'), { statusCode: 401 })
      },
    })

    const response = await request(app)
      .get('/api/big-screen/auth/check')

    expect(response.status).toBe(401)
    expect(response.body.error).toBe('请先登录')
  })

  it('returns stale snapshot when the source times out', async () => {
    const okEnvelope: MetricEnvelope<{ total: number }> = {
      schemaVersion: '1.0',
      systemKey: 'sca',
      metricKey: 'security-overview',
      generatedAt: '2026-06-10T05:00:00.000Z',
      sourceUpdatedAt: '2026-06-10T04:59:45.000Z',
      stale: false,
      status: 'ok',
      data: { total: 9 },
      unavailableSources: [],
    }
    const cache = new MetricCache()
    cache.seed(
      metricCacheKey(
        'sca',
        'security-overview',
        {},
        JSON.stringify({ userId: 7, apps: ['big-screen', 'sca'], scope: {} }),
      ),
      okEnvelope,
      { ageMs: 31_000 },
    )
    const source: MetricAdapter = {
      systemKey: 'sca',
      async getMetric() {
        throw new Error('timeout')
      },
    }
    const service = new MetricService({ adapters: [source], cache })
    const app = createApp({
      service,
      authorize: async () => ({
        user: { id: 7, username: 'viewer', role: 'user' },
        apps: ['big-screen', 'sca'],
        allowedSystems: ['sca'],
        screenRole: 'viewer',
        scope: {},
      }),
    })

    const response = await request(app)
      .get('/api/big-screen/data/sca/security-overview')
      .set('Cookie', 'juxin_auth_token=test')

    expect(response.status).toBe(200)
    expect(response.body.status).toBe('stale')
    expect(response.body.stale).toBe(true)
    expect(response.body.data).toEqual(okEnvelope.data)
  })

  it('rejects data access for a source system missing from unified app access', async () => {
    const source: MetricAdapter = {
      systemKey: 'sca',
      async getMetric() {
        throw new Error('should not run')
      },
    }
    const app = createApp({
      service: new MetricService({ adapters: [source], cache: new MetricCache() }),
      authorize: async () => ({
        user: { id: 7, username: 'viewer', role: 'user' },
        apps: ['big-screen', 'reminder'],
        allowedSystems: ['reminder'],
        screenRole: 'viewer',
        scope: {},
      }),
    })

    const response = await request(app)
      .get('/api/big-screen/data/sca/security-overview')
      .set('Cookie', 'juxin_auth_token=test')

    expect(response.status).toBe(403)
    expect(response.body.error).toBe('无权限访问该大屏数据源')
  })

  it('rejects a metric that belongs to a different source system', async () => {
    let calls = 0
    const source: MetricAdapter = {
      systemKey: 'sca',
      async getMetric() {
        calls += 1
        throw new Error('should not run')
      },
    }
    const app = createApp({
      service: new MetricService({ adapters: [source], cache: new MetricCache() }),
      authorize: async () => ({
        user: { id: 7, username: 'viewer', role: 'user' },
        apps: ['big-screen', 'sca'],
        allowedSystems: ['sca'],
        screenRole: 'viewer',
        scope: {},
      }),
    })

    const response = await request(app)
      .get('/api/big-screen/data/sca/exam-command')
      .set('Cookie', 'juxin_auth_token=test')

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('指标与大屏数据源不匹配')
    expect(calls).toBe(0)
  })
})
