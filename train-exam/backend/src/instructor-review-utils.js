const trimText = (value) => (value === undefined || value === null ? '' : String(value).trim());

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

const normalizeInstructorReviewInput = (payload = {}) => ({
  rating: toBoundedScore(payload.rating, 5),
  clarity_score: toBoundedScore(payload.clarity_score, 5),
  interaction_score: toBoundedScore(payload.interaction_score, 5),
  practical_score: toBoundedScore(payload.practical_score, 5),
  pace_score: toBoundedScore(payload.pace_score, 5),
  qa_score: toBoundedScore(payload.qa_score, 5),
  feedback: trimText(payload.feedback).slice(0, 1000),
  anonymous: normalizeBooleanFlag(payload.anonymous),
});

const normalizeInstructorReviewStatus = (value) => {
  const key = trimText(value).toLowerCase();
  if (['resolved', 'done', 'closed', '已处理', '处理'].includes(key)) return 'resolved';
  return 'pending';
};

const canUserReviewCourse = ({ enrollment = null, progressCount = 0 } = {}) =>
  !!enrollment || Number(progressCount || 0) > 0;

const average = (rows, key) => {
  const values = rows
    .map((item) => Number(item?.[key] || 0))
    .filter((item) => Number.isFinite(item) && item > 0);
  if (!values.length) return 0;
  return Math.round((values.reduce((sum, item) => sum + item, 0) / values.length) * 100) / 100;
};

const buildInstructorReviewSummary = (rows = []) => {
  const items = Array.isArray(rows) ? rows : [];
  const instructorRatings = new Map();
  for (const item of items) {
    const instructor = trimText(item?.instructor_name) || '未指定讲师';
    const list = instructorRatings.get(instructor) || [];
    list.push(Number(item?.rating || 0));
    instructorRatings.set(instructor, list);
  }
  const excellentInstructorCount = Array.from(instructorRatings.values()).filter((list) => {
    const valid = list.filter((item) => Number.isFinite(item) && item > 0);
    if (!valid.length) return false;
    const value = valid.reduce((sum, item) => sum + item, 0) / valid.length;
    return value >= 4.5;
  }).length;

  return {
    total_reviews: items.length,
    pending_count: items.filter((item) => normalizeInstructorReviewStatus(item?.status) === 'pending').length,
    resolved_count: items.filter((item) => normalizeInstructorReviewStatus(item?.status) === 'resolved').length,
    average_rating: average(items, 'rating'),
    excellent_instructor_count: excellentInstructorCount,
    dimensions: {
      clarity_score: average(items, 'clarity_score'),
      interaction_score: average(items, 'interaction_score'),
      practical_score: average(items, 'practical_score'),
      pace_score: average(items, 'pace_score'),
      qa_score: average(items, 'qa_score'),
    },
  };
};

module.exports = {
  buildInstructorReviewSummary,
  canUserReviewCourse,
  normalizeInstructorReviewInput,
  normalizeInstructorReviewStatus,
};
