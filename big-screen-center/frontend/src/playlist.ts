export type PlaylistTransition = 'fade' | 'slide' | 'zoom'

export interface PlaylistItem {
  templateId: string
  version: number
  durationSeconds: number
  transition: PlaylistTransition
  filters: Record<string, string | string[]>
}

export interface PlaylistController {
  current(): PlaylistItem
  index(): number
  isPaused(): boolean
  next(): PlaylistItem
  previous(): PlaylistItem
  failCurrent(): PlaylistItem
  togglePaused(): boolean
  sync(now: number): PlaylistItem
}

const validateItems = (items: PlaylistItem[]) => {
  if (items.length === 0) throw new Error('Playlist requires at least one item')
  for (const item of items) {
    if (
      !Number.isInteger(item.durationSeconds)
      || item.durationSeconds < 10
      || item.durationSeconds > 1800
    ) {
      throw new Error('Playlist duration must be between 10 and 1800 seconds')
    }
  }
}

export const createPlaylistController = (
  items: PlaylistItem[],
  startedAt = Date.now(),
): PlaylistController => {
  validateItems(items)
  let currentIndex = 0
  let paused = false
  let anchor = startedAt
  let pausedAt = 0

  const select = (index: number) => {
    currentIndex = (index + items.length) % items.length
    return items[currentIndex]!
  }
  const selectManually = (index: number) => {
    const selected = select(index)
    const elapsedBeforeItem = items
      .slice(0, currentIndex)
      .reduce((sum, item) => sum + item.durationSeconds * 1000, 0)
    anchor = Date.now() - elapsedBeforeItem
    return selected
  }

  return {
    current: () => items[currentIndex]!,
    index: () => currentIndex,
    isPaused: () => paused,
    next: () => selectManually(currentIndex + 1),
    previous: () => selectManually(currentIndex - 1),
    failCurrent: () => selectManually(currentIndex + 1),
    togglePaused: () => {
      paused = !paused
      if (paused) pausedAt = Date.now()
      else anchor += Date.now() - pausedAt
      return paused
    },
    sync(now: number) {
      if (paused) return items[currentIndex]!
      const totalMs = items.reduce(
        (sum, item) => sum + item.durationSeconds * 1000,
        0,
      )
      let elapsed = Math.max(0, now - anchor) % totalMs
      for (let index = 0; index < items.length; index += 1) {
        const duration = items[index]!.durationSeconds * 1000
        if (elapsed < duration) return select(index)
        elapsed -= duration
      }
      return select(0)
    },
  }
}
