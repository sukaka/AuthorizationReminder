export type Bootstrap = { hour_remaining: number; hour_limit: number; day_remaining: number; day_limit: number }
export type Source = { file_uuid: string; file_name: string; section_title: string; page_number: number | null }
export type Document = { file_uuid: string; file_name: string; summary: string; file_type: string; file_size: number; updated_at: string }
export const isSafeSameOriginUrl = (raw: string): boolean => {
  try {
    const url = new URL(raw, location.origin)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === location.origin
  } catch {
    return false
  }
}
const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`/api/wechat/external${path}`, { credentials: 'include', ...init })
  if (response.status === 401) { location.assign('/api/wechat/external/oauth/login?return_to=/'); throw new Error('未登录') }
  if (!response.ok) throw new Error(response.status === 429 ? '额度已用完，请稍后再试' : response.status === 503 ? '系统繁忙，请稍后再试' : '请求失败，请重试')
  return response.json() as Promise<T>
}
export const api = {
  bootstrap: () => request<Bootstrap>('/bootstrap'),
  documents: () => request<Document[]>('/documents'),
  ask: (question: string) => request<{ answer: string; sources: Source[]; hour_remaining: number; day_remaining: number }>('/questions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  }),
  download: async (id: string) => {
    const downloadUrl = (await request<{ download_url: string }>(`/documents/${id}/download-token`, { method: 'POST' })).download_url
    if (!isSafeSameOriginUrl(downloadUrl)) throw new Error('下载链接不安全，已阻止本次下载')
    return downloadUrl
  },
}
