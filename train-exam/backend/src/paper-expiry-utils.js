const DEFAULT_PAPER_EXAM_WINDOW_HOURS = 72;
const MAX_PAPER_EXAM_WINDOW_HOURS = 8760;

const trimText = (value) => (value === undefined || value === null ? '' : String(value).trim());

const toMysqlDatetime = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

const parseStoredUtcMysqlDateTime = (value) => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = trimText(value);
  const matched = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!matched) return null;
  const [, year, month, day, hour, minute, second] = matched;
  const date = new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  ));
  return Number.isNaN(date.getTime()) ? null : date;
};

const normalizePaperExamWindowHours = (value) => {
  const raw = trimText(value);
  if (!raw) return DEFAULT_PAPER_EXAM_WINDOW_HOURS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_PAPER_EXAM_WINDOW_HOURS;
  return Math.max(1, Math.min(MAX_PAPER_EXAM_WINDOW_HOURS, Math.floor(parsed)));
};

const buildPaperExamDeadlineDate = (paper = {}) => {
  const publishedAt = parseStoredUtcMysqlDateTime(paper?.published_at);
  if (!publishedAt) return null;
  const hours = normalizePaperExamWindowHours(paper?.exam_window_hours);
  return new Date(publishedAt.getTime() + hours * 60 * 60 * 1000);
};

const buildPaperExamDeadline = (paper = {}) => toMysqlDatetime(buildPaperExamDeadlineDate(paper));

const isPaperExamExpired = (paper = {}, { now = new Date() } = {}) => {
  const deadline = buildPaperExamDeadlineDate(paper);
  if (!deadline) return false;
  const current = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(current.getTime())) return false;
  return current.getTime() >= deadline.getTime();
};

module.exports = {
  DEFAULT_PAPER_EXAM_WINDOW_HOURS,
  MAX_PAPER_EXAM_WINDOW_HOURS,
  buildPaperExamDeadline,
  buildPaperExamDeadlineDate,
  isPaperExamExpired,
  normalizePaperExamWindowHours,
};
