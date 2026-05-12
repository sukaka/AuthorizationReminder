export const EXAM_SESSION_STORAGE_KEY = 'train-exam.current-exam-session-id'

const getSafeStorage = (storage) => {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') return null
  return storage
}

export const readPersistedExamSessionId = (storage) => {
  const safeStorage = getSafeStorage(storage)
  if (!safeStorage) return 0
  try {
    const raw = String(safeStorage.getItem(EXAM_SESSION_STORAGE_KEY) || '').trim()
    if (!raw) return 0
    const sessionId = Number(raw)
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      safeStorage.removeItem(EXAM_SESSION_STORAGE_KEY)
      return 0
    }
    return sessionId
  } catch {
    return 0
  }
}

export const persistExamSessionId = (storage, sessionId) => {
  const safeStorage = getSafeStorage(storage)
  if (!safeStorage) return
  const sid = Number(sessionId || 0)
  if (!Number.isInteger(sid) || sid <= 0) {
    safeStorage.removeItem(EXAM_SESSION_STORAGE_KEY)
    return
  }
  safeStorage.setItem(EXAM_SESSION_STORAGE_KEY, String(sid))
}

export const clearPersistedExamSessionId = (storage) => {
  const safeStorage = getSafeStorage(storage)
  if (!safeStorage) return
  safeStorage.removeItem(EXAM_SESSION_STORAGE_KEY)
}
