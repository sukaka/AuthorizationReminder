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
    expect(wrapper.classes()).toContain('source-health--light')
    expect(wrapper.text()).toContain('生成')
    expect(wrapper.text()).toContain('2 个来源不可用')
    expect(wrapper.text()).toContain('软件成分分析、授权提醒')
  })

  it('names unavailable adapter sources instead of only showing a count', () => {
    const wrapper = mount(SourceHealthBar, {
      props: {
        status: 'partial',
        generatedAt: '2026-06-11T08:09:10.000Z',
        stale: false,
        unavailableSources: ['dependencyCheck', 'passTrend', 'unknown-source'],
      },
    })

    expect(wrapper.text()).toContain('3 个来源不可用')
    expect(wrapper.text()).toContain('Dependency-Check、考试通过趋势、unknown-source')
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
    expect(wrapper.text()).toContain('已过期')
    expect(wrapper.text()).toContain('等待数据')
  })
})
