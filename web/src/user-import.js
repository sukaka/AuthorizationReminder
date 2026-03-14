const extractFilenameFromContentDisposition = (value) => {
  const text = String(value || '').trim()
  if (!text) return ''

  const utf8Match = text.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim())
    } catch {
      return utf8Match[1].trim()
    }
  }

  const quotedMatch = text.match(/filename\s*=\s*"([^"]+)"/i)
  if (quotedMatch?.[1]) return quotedMatch[1].trim()

  const plainMatch = text.match(/filename\s*=\s*([^;]+)/i)
  if (plainMatch?.[1]) return plainMatch[1].trim()

  return ''
}

export const readUserImportDownloadFilename = (headers, fallback = 'user-import-result.xlsx') => {
  const explicitFilename = String(headers?.get?.('X-Import-Filename') || '').trim()
  if (explicitFilename) return explicitFilename

  const contentDisposition = headers?.get?.('Content-Disposition') || ''
  return extractFilenameFromContentDisposition(contentDisposition) || fallback
}

export const readUserImportSummary = (headers) => ({
  total: Number(headers.get('X-Import-Total') || 0),
  created: Number(headers.get('X-Import-Created') || 0),
  skipped: Number(headers.get('X-Import-Skipped') || 0),
  errorCount: Number(headers.get('X-Import-Error-Count') || 0),
  filename: readUserImportDownloadFilename(headers, 'user-import-result.xlsx'),
})
