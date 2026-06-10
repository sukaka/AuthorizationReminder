import { afterEach, describe, expect, it, vi } from 'vitest'

import { StreamHub } from '../src/stream-hub.js'

describe('StreamHub', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shares one producer and releases its timer after the last subscriber leaves', async () => {
    vi.useFakeTimers()
    const hub = new StreamHub()
    const producer = vi.fn(async () => ({ total: producer.mock.calls.length }))
    const first = vi.fn()
    const second = vi.fn()

    const unsubscribeFirst = hub.subscribe('sca:security-overview', 1000, producer, first)
    const unsubscribeSecond = hub.subscribe('sca:security-overview', 1000, producer, second)
    await vi.advanceTimersByTimeAsync(2100)

    expect(hub.activeStreamCount()).toBe(1)
    expect(producer).toHaveBeenCalledTimes(3)
    expect(first).toHaveBeenCalledTimes(3)
    expect(second).toHaveBeenCalledTimes(3)

    unsubscribeFirst()
    unsubscribeSecond()
    const callsAfterClose = producer.mock.calls.length
    await vi.advanceTimersByTimeAsync(3000)

    expect(hub.activeStreamCount()).toBe(0)
    expect(producer).toHaveBeenCalledTimes(callsAfterClose)
  })
})
