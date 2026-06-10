import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SourceHealthBar from '../src/components/SourceHealthBar.vue'

describe('SourceHealthBar', () => {
  it('always displays generated time and degraded source count', () => {
    const wrapper = mount(SourceHealthBar, {
      props: {
        status: 'partial',
        generatedAt: '2026-06-11T08:09:10.000Z',
        stale: false,
        unavailableSources: ['sca', 'reminder'],
      },
    })

    expect(wrapper.attributes('data-source-status')).toBe('partial')
    expect(wrapper.text()).toContain('生成')
    expect(wrapper.text()).toContain('2 个来源不可用')
  })

  it('uses the stale state as the visible status', () => {
    const wrapper = mount(SourceHealthBar, {
      props: {
        status: 'ok',
        generatedAt: null,
        stale: true,
        unavailableSources: [],
      },
    })

    expect(wrapper.attributes('data-source-status')).toBe('stale')
    expect(wrapper.text()).toContain('STALE')
    expect(wrapper.text()).toContain('等待数据')
  })
})
