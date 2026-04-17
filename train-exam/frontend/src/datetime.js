const SHANGHAI_TIME_ZONE = 'Asia/Shanghai'
const STORED_UTC_TEXT_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/

const trimText = (value) => (value === undefined || value === null ? '' : String(value).trim())

const parseStoredDateTime = (value) => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const text = trimText(value)
  if (!text) return null

  const matched = text.match(STORED_UTC_TEXT_RE)
  if (matched) {
    const [, year, month, day, hour, minute, second] = matched
    return new Date(Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ))
  }

  const normalized = text.includes(' ') ? text.replace(' ', 'T') : text
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

export const formatDateTime = (value) => {
  if (!value) return '-'
  const date = parseStoredDateTime(value)
  if (!date) return String(value)
  return date.toLocaleString('zh-CN', {
    hour12: false,
    timeZone: SHANGHAI_TIME_ZONE,
  })
}

export { parseStoredDateTime }
