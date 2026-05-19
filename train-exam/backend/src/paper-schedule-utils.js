const SCHEDULED_PAPER_STATUS = 'scheduled';
const SHANGHAI_OFFSET_MINUTES = 8 * 60;

const trimText = (value) => (value === undefined || value === null ? '' : String(value).trim());

const createScheduleError = (message, statusCode = 400) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const toMysqlDatetime = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

const parseShanghaiLocalDateTime = (value) => {
  const text = trimText(value).replace('T', ' ');
  const matched = text.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!matched) throw createScheduleError('定时发布时间格式无效');

  const [, yearText, monthText, dayText, hourText, minuteText, secondText = '00'] = matched;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);

  const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const valid =
    Number.isInteger(year)
    && month >= 1
    && month <= 12
    && day >= 1
    && day <= dayCount
    && hour >= 0
    && hour <= 23
    && minute >= 0
    && minute <= 59
    && second >= 0
    && second <= 59;
  if (!valid) throw createScheduleError('定时发布时间格式无效');

  const utcTime = Date.UTC(year, month - 1, day, hour, minute, second) - SHANGHAI_OFFSET_MINUTES * 60 * 1000;
  return new Date(utcTime);
};

const parseStoredUtcMysqlDateTime = (value) => {
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

const normalizeScheduledPublishAt = (value, { now = new Date() } = {}) => {
  const date = parseShanghaiLocalDateTime(value);
  if (date.getTime() <= now.getTime()) {
    throw createScheduleError('定时发布时间必须晚于当前时间');
  }
  return toMysqlDatetime(date);
};

const isScheduledPaperDue = (paper, { now = new Date() } = {}) => {
  if (trimText(paper?.status).toLowerCase() !== SCHEDULED_PAPER_STATUS) return false;
  const scheduledAt = parseStoredUtcMysqlDateTime(paper?.scheduled_publish_at);
  return !!scheduledAt && scheduledAt.getTime() <= now.getTime();
};

module.exports = {
  SCHEDULED_PAPER_STATUS,
  isScheduledPaperDue,
  normalizeScheduledPublishAt,
  parseShanghaiLocalDateTime,
  parseStoredUtcMysqlDateTime,
};
