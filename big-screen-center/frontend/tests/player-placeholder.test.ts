import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PlayerPlaceholder from '../src/views/PlayerPlaceholder.vue'

describe('PlayerPlaceholder', () => {
  it('renders the selected template id without runtime template compilation', () => {
    const wrapper = mount(PlayerPlaceholder, {
      props: {
        templateId: 'sca-01',
      },
      global: {
        stubs: {
          RouterLink: {
            template: '<a><slot /></a>',
          },
        },
      },
    })

    expect(wrapper.text()).toContain('sca-01')
    expect(wrapper.text()).toContain('播放器正在装配')
  })
})
