export const logoutFromSso = async ({ apiBase = '', fetchImpl = fetch } = {}) => {
  try {
    const base = String(apiBase || '').trim()
    const csrfResp = await fetchImpl(`${base}/api/auth/csrf`, { credentials: 'include' })
    if (!csrfResp.ok) return false

    let csrfToken = ''
    try {
      const csrfPayload = await csrfResp.json()
      csrfToken = String(csrfPayload?.token || '')
    } catch {
      csrfToken = ''
    }
    if (!csrfToken) return false

    const logoutResp = await fetchImpl(`${base}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'X-CSRF-Token': csrfToken,
      },
    })
    return logoutResp.ok
  } catch {
    return false
  }
}
