export class CircuitOpenError extends Error {
  constructor() {
    super('Upstream circuit is open')
    this.name = 'CircuitOpenError'
  }
}

export interface CircuitBreakerOptions {
  failureThreshold?: number
  openMs?: number
  now?: () => number
}

export class CircuitBreaker {
  private failures = 0
  private openUntil = 0
  private probeInFlight = false
  private readonly failureThreshold: number
  private readonly openMs: number
  private readonly now: () => number

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold || 5
    this.openMs = options.openMs || 30_000
    this.now = options.now || Date.now
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    const currentTime = this.now()
    const isOpen = this.openUntil > currentTime
    if (isOpen || (this.openUntil > 0 && this.probeInFlight)) {
      throw new CircuitOpenError()
    }

    const halfOpen = this.openUntil > 0
    if (halfOpen) this.probeInFlight = true
    try {
      const result = await operation()
      this.failures = 0
      this.openUntil = 0
      return result
    } catch (error) {
      this.failures += 1
      if (halfOpen || this.failures >= this.failureThreshold) {
        this.openUntil = this.now() + this.openMs
      }
      throw error
    } finally {
      if (halfOpen) this.probeInFlight = false
    }
  }
}
