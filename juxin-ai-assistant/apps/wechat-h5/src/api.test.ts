import { describe, expect, it, vi } from 'vitest'

import { api } from './api'

describe('external H5 API client', () => {
  it('uses the HttpOnly session cookie for every request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ hour_remaining: 15, hour_limit: 15, day_remaining: 30, day_limit: 30 })))
    vi.stubGlobal('fetch', fetchMock)

    await api.bootstrap()

    expect(fetchMock).toHaveBeenCalledWith('/api/wechat/external/bootstrap', { credentials: 'include' })
  })
})
