import { defineComponent, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useDataChannel } from '../src/composables/useDataChannel'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useDataChannel', () => {
  it('does not open network channels when disabled', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(defineComponent({
      setup() {
        return useDataChannel({
          systemKey: ref('sca'),
          metricKey: ref('security-overview'),
          filters: ref({}),
          mode: ref('poll'),
          intervalMs: ref(60_000),
          enabled: ref(false),
        })
      },
      template: '<div />',
    }))
    await nextTick()

    expect(fetchMock).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('keeps the response status code when a data request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: '请先登录' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )))

    const wrapper = mount(defineComponent({
      setup() {
        return useDataChannel({
          systemKey: ref('sca'),
          metricKey: ref('security-overview'),
          filters: ref({}),
          mode: ref('poll'),
          intervalMs: ref(60_000),
        })
      },
      template: '<div />',
    }))

    await vi.waitFor(() => {
      expect(wrapper.vm.state).toBe('error')
      expect(wrapper.vm.error).toBe('请先登录')
      expect(wrapper.vm.errorStatusCode).toBe(401)
    })
    wrapper.unmount()
  })
})
