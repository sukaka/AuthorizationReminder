interface StreamEntry<T> {
  listeners: Set<(value: T) => void>
  timer: ReturnType<typeof setInterval>
  running: boolean
}

export class StreamHub {
  private readonly streams = new Map<string, StreamEntry<unknown>>()

  subscribe<T>(
    key: string,
    intervalMs: number,
    producer: () => Promise<T>,
    listener: (value: T) => void,
  ) {
    let entry = this.streams.get(key) as StreamEntry<T> | undefined
    if (!entry) {
      const listeners = new Set<(value: T) => void>()
      const tick = async () => {
        const current = this.streams.get(key) as StreamEntry<T> | undefined
        if (!current || current.running) return
        current.running = true
        try {
          const value = await producer()
          for (const currentListener of current.listeners) currentListener(value)
        } catch {
          // The next interval remains available for recovery.
        } finally {
          current.running = false
        }
      }
      entry = {
        listeners,
        timer: setInterval(() => void tick(), intervalMs),
        running: false,
      }
      this.streams.set(key, entry as StreamEntry<unknown>)
      void tick()
    }
    entry.listeners.add(listener)

    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      const current = this.streams.get(key) as StreamEntry<T> | undefined
      if (!current) return
      current.listeners.delete(listener)
      if (current.listeners.size === 0) {
        clearInterval(current.timer)
        this.streams.delete(key)
      }
    }
  }

  activeStreamCount() {
    return this.streams.size
  }

  close() {
    for (const stream of this.streams.values()) clearInterval(stream.timer)
    this.streams.clear()
  }
}
