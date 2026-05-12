const trimText = (value) => String(value || '').trim()

const parseExamSessionDate = (value) => {
  const text = trimText(value)
  if (!text) return null
  const date = new Date(text.replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return null
  return date
}

const getExamSessionExpireTs = (session) => {
  const started = parseExamSessionDate(session?.started_at)
  if (!started) return Date.now()
  return started.getTime() + Math.max(1, Number(session?.duration_minutes || 60)) * 60 * 1000
}

const shouldResumeExistingExamSession = ({ session, now = new Date() } = {}) => {
  if (!session) return false
  if (trimText(session.status).toLowerCase() !== 'started') return false
  return now.getTime() < getExamSessionExpireTs(session)
}

module.exports = {
  getExamSessionExpireTs,
  parseExamSessionDate,
  shouldResumeExistingExamSession,
}
