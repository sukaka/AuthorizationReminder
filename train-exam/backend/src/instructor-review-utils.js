const trimText = (value) => (value === undefined || value === null ? '' : String(value).trim());

const STATUS_ALIASES = {
  draft: 'draft',
  '草稿': 'draft',
  scheduled: 'scheduled',
  schedule: 'scheduled',
  '待发布': 'scheduled',
  published: 'published',
  publish: 'published',
  '已发布': 'published',
  closed: 'closed',
  close: 'closed',
  '已关闭': 'closed',
};

const RATING_LABELS = {
  5: '极好',
  4: '优秀',
  3: '普通',
  2: '一般',
  1: '极差',
};

const SCORE_KEYS = [
  'clarity_score',
  'interaction_score',
  'practical_score',
  'time_control_score',
  'qa_score',
];

const toBoundedScore = (value, fallback = 5) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(1, Math.min(5, Math.round(num)));
};

const normalizeBooleanFlag = (value) => {
  if (typeof value === 'boolean') return value ? 1 : 0;
  const key = trimText(value).toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on', '匿名'].includes(key) ? 1 : 0;
};

const normalizeInstructorReviewStatus = (value) => {
  const key = trimText(value).toLowerCase();
  return STATUS_ALIASES[key] || 'draft';
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

const isScheduledInstructorReviewDue = (form, { now = new Date() } = {}) => {
  if (trimText(form?.status).toLowerCase() !== 'scheduled') return false;
  const scheduledAt = parseStoredUtcMysqlDateTime(form?.scheduled_publish_at);
  return !!scheduledAt && scheduledAt.getTime() <= now.getTime();
};

const normalizeInstructorQuestionnaireInput = (payload = {}) => ({
  title: trimText(payload.title).slice(0, 255),
  instructor_name: trimText(payload.instructor_name).slice(0, 128),
  description: trimText(payload.description).slice(0, 2000),
  status: normalizeInstructorReviewStatus(payload.status),
});

const getRatingLabel = (score) => RATING_LABELS[Math.max(1, Math.min(5, Math.round(Number(score || 0))))] || '极差';

const normalizeInstructorReviewResponseInput = (payload = {}) => {
  const scores = SCORE_KEYS.reduce((acc, key) => {
    acc[key] = toBoundedScore(payload[key], 5);
    return acc;
  }, {});
  const scoreTotal = SCORE_KEYS.reduce((sum, key) => sum + Number(scores[key] || 0), 0);
  const finalScore = Number((scoreTotal / SCORE_KEYS.length).toFixed(2));
  return {
    ...scores,
    final_score: finalScore,
    rating_label: getRatingLabel(finalScore),
    feedback: trimText(payload.feedback).slice(0, 1000),
    anonymous: normalizeBooleanFlag(payload.anonymous),
  };
};

const average = (rows, key) => {
  const values = rows
    .map((item) => Number(item?.[key] || 0))
    .filter((item) => Number.isFinite(item) && item > 0);
  if (!values.length) return 0;
  return Math.round((values.reduce((sum, item) => sum + item, 0) / values.length) * 100) / 100;
};

const buildInstructorReviewQuestionnaireSummary = (rows = []) => {
  const items = Array.isArray(rows) ? rows : [];
  const ratingDistribution = {
    '极好': 0,
    '优秀': 0,
    '普通': 0,
    '一般': 0,
    '极差': 0,
  };
  for (const item of items) {
    const label = trimText(item?.rating_label) || getRatingLabel(item?.final_score);
    if (Object.prototype.hasOwnProperty.call(ratingDistribution, label)) {
      ratingDistribution[label] += 1;
    }
  }
  return {
    response_count: items.length,
    average_final_score: average(items, 'final_score'),
    rating_distribution: ratingDistribution,
    dimensions: SCORE_KEYS.reduce((acc, key) => {
      acc[key] = average(items, key);
      return acc;
    }, {}),
  };
};

module.exports = {
  SCORE_KEYS,
  buildInstructorReviewQuestionnaireSummary,
  getRatingLabel,
  isScheduledInstructorReviewDue,
  normalizeInstructorQuestionnaireInput,
  normalizeInstructorReviewResponseInput,
  normalizeInstructorReviewStatus,
};
