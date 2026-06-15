import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PlaylistPanel from '../src/components/PlaylistPanel.vue'
import { createPlaylistController } from '../src/playlist'

const items = [
  {
    templateId: 'sca-01',
    version: 2,
    durationSeconds: 30,
    transition: 'fade' as const,
    filters: {},
  },
  {
    templateId: 'train-01',
    version: 1,
    durationSeconds: 20,
    transition: 'slide' as const,
    filters: {},
  },
]

describe('playlist controller', () => {
  it('skips a failed item and preserves playlist order', () => {
    const controller = createPlaylistController(items, 0)

    controller.failCurrent()

    expect(controller.current().templateId).toBe('train-01')
  })

  it('pauses, resumes, and navigates in both directions', () => {
    const controller = createPlaylistController(items, 0)

    expect(controller.togglePaused()).toBe(true)
    expect(controller.togglePaused()).toBe(false)
    controller.next()
    controller.sync(Date.now())
    expect(controller.current().templateId).toBe('train-01')
    controller.previous()
    expect(controller.current().templateId).toBe('sca-01')
  })

  it('recalculates the current item from absolute elapsed time', () => {
    const controller = createPlaylistController(items, 0)

    controller.sync(35_000)

    expect(controller.current().templateId).toBe('train-01')
  })

  it('renders playback controls with the mobile controls hook', () => {
    const wrapper = mount(PlaylistPanel, {
      props: {
        items,
        currentIndex: 0,
        paused: false,
        controlsVisible: true,
      },
    })

    expect(wrapper.get('[data-mobile-playback-controls]').classes())
      .toContain('playlist-panel')
    expect(wrapper.text()).toContain('播放清单')
    expect(wrapper.text()).toContain('sca-01')
  })
})
