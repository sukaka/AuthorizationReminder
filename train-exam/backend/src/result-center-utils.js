const RESULT_LIST_MAX_LIMIT = 100;
const RESULT_TYPE_ORDER = ['single_choice', 'multiple_choice', 'judgement', 'fill_blank'];

const trimText = (value) => (value === undefined || value === null ? '' : String(value).trim());

const toPositiveInt = (value, fallback = 1) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
};

const toNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toBoundedLimit = (value, fallback = 20) => Math.min(toPositiveInt(value, fallback), RESULT_LIST_MAX_LIMIT);

const normalizeBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const key = trimText(value).toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(key)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(key)) return false;
  return fallback;
};

const roundTo = (value, digits = 2) => {
  const num = toNumber(value, 0);
  const base = 10 ** digits;
  return Math.round(num * base) / base;
};

const parseMaybeJson = (value, fallback = null) => {
  if (value && typeof value === 'object') return value;
  const text = trimText(value);
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};

const normalizeQuestionType = (value) => {
  const key = trimText(value).toLowerCase();
  if (RESULT_TYPE_ORDER.includes(key)) return key;
  return key || 'single_choice';
};

const normalizePassedFilter = (value) => {
  const key = trimText(value).toLowerCase();
  if (!key || key === 'all') return '';
  if (['1', 'true', 'pass', 'passed', '通过'].includes(key)) return 1;
  if (['0', 'false', 'fail', 'failed', '未通过'].includes(key)) return 0;
  return '';
};

const isDateText = (value) => /^\d{4}-\d{2}-\d{2}$/.test(trimText(value));

const addOneDay = (dateText) => {
  if (!isDateText(dateText)) return '';
  const date = new Date(`${dateText}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

const STORED_UTC_TEXT_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;
const SHANGHAI_DATETIME_FORMATTER = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai',
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const parseStoredUtcDate = (value) => {
  const text = trimText(value);
  if (!text) return null;
  const matched = text.match(STORED_UTC_TEXT_RE);
  if (matched) {
    const [, year, month, day, hour, minute, second] = matched;
    return new Date(Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ));
  }
  const normalized = text.includes(' ') ? text.replace(' ', 'T') : text;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatShanghaiDateTime = (value) => {
  const text = trimText(value);
  if (!text) return '';
  const date = parseStoredUtcDate(text);
  if (!date) return text;
  return SHANGHAI_DATETIME_FORMATTER.format(date).replace(' ', ' ');
};

const buildDateStart = (value) => {
  const text = trimText(value);
  return isDateText(text) ? `${text} 00:00:00` : '';
};

const buildDateEnd = (value) => {
  const text = trimText(value);
  const next = addOneDay(text);
  return next ? `${next} 00:00:00` : '';
};

const normalizeAdminResultsFilters = (filters = {}) => ({
  keyword: trimText(filters?.keyword),
  user_id: toPositiveInt(filters?.user_id, 0),
  paper_id: toPositiveInt(filters?.paper_id, 0),
  passed: normalizePassedFilter(filters?.passed),
  final_only: normalizeBoolean(filters?.final_only, false),
  date_from: isDateText(filters?.date_from) ? trimText(filters?.date_from) : '',
  date_to: isDateText(filters?.date_to) ? trimText(filters?.date_to) : '',
  page: toPositiveInt(filters?.page, 1),
  limit: toBoundedLimit(filters?.limit, 20),
});

const buildAdminResultsWhere = (filters = {}) => {
  const normalized = normalizeAdminResultsFilters(filters);
  const where = [];
  const params = [];

  if (normalized.keyword) {
    where.push('(r.username LIKE ? OR IFNULL(r.user_department, \'\') LIKE ? OR IFNULL(p.name, \'\') LIKE ?)');
    params.push(`%${normalized.keyword}%`, `%${normalized.keyword}%`, `%${normalized.keyword}%`);
  }
  if (normalized.user_id > 0) {
    where.push('r.user_id = ?');
    params.push(normalized.user_id);
  }
  if (normalized.paper_id > 0) {
    where.push('r.paper_id = ?');
    params.push(normalized.paper_id);
  }
  if (normalized.passed === 0 || normalized.passed === 1) {
    where.push('r.passed = ?');
    params.push(normalized.passed);
  }
  if (normalized.final_only) {
    where.push('r.is_final = 1');
  }
  if (normalized.date_from) {
    where.push('r.created_at >= ?');
    params.push(buildDateStart(normalized.date_from));
  }
  if (normalized.date_to) {
    where.push('r.created_at < ?');
    params.push(buildDateEnd(normalized.date_to));
  }

  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
};

const normalizeAdminResultListRow = (item = {}) => ({
  ...item,
  id: toPositiveInt(item.id, 0),
  session_id: toPositiveInt(item.session_id, 0),
  user_id: toPositiveInt(item.user_id, 0),
  paper_id: toPositiveInt(item.paper_id, 0),
  score: toNumber(item.score, 0),
  total_score: toNumber(item.total_score, 0),
  passed: toNumber(item.passed, 0),
  attempt_no: toPositiveInt(item.attempt_no, 0),
  is_final: toNumber(item.is_final, 0),
  duration_seconds: toPositiveInt(item.duration_seconds, 0),
  wrong_count: toPositiveInt(item.wrong_count, 0),
});

const normalizeAdminResultsSummary = (item = {}) => {
  const total = toPositiveInt(item.total_results, 0);
  const passCount = toPositiveInt(item.pass_count, 0);
  return {
    total_results: total,
    pass_count: passCount,
    fail_count: toPositiveInt(item.fail_count, 0),
    average_score: roundTo(item.average_score, 2),
    average_duration_seconds: toPositiveInt(item.average_duration_seconds, 0),
    final_result_count: toPositiveInt(item.final_result_count, 0),
    pass_rate: total > 0 ? roundTo((passCount / total) * 100, 2) : 0,
  };
};

const diffSeconds = (startedAt, endedAt) => {
  const started = new Date(String(startedAt || '').replace(' ', 'T'));
  const ended = new Date(String(endedAt || '').replace(' ', 'T'));
  if (Number.isNaN(started.getTime()) || Number.isNaN(ended.getTime())) return 0;
  return Math.max(0, Math.round((ended.getTime() - started.getTime()) / 1000));
};

const normalizeAiAdvice = (row) => {
  if (!row) return null;
  return {
    ...row,
    id: toPositiveInt(row.id, 0),
    status: trimText(row.status),
    advice_text: trimText(row.advice_text),
    model_name: trimText(row.model_name),
    error_message: trimText(row.error_message),
    updated_at: row.updated_at,
  };
};

const buildQuestionReviewRow = (row = {}) => {
  const snapshot = parseMaybeJson(row.question_snapshot_json, {});
  const standardAnswer = parseMaybeJson(row.standard_answer_json, {});
  return {
    question_id: toPositiveInt(row.question_id, 0),
    sort_order: toPositiveInt(row.sort_order, 0),
    stem: trimText(snapshot?.stem),
    question_type: normalizeQuestionType(snapshot?.question_type),
    points: toNumber(snapshot?.points, 0),
    earned_score: toNumber(row.earned_score, 0),
    is_correct: toNumber(row.is_correct, 0) === 1,
    user_answer: parseMaybeJson(row.user_answer_json, null),
    standard_answer: standardAnswer,
    explanation: trimText(snapshot?.explanation),
    options: Array.isArray(snapshot?.options) ? snapshot.options : [],
  };
};

const buildQuestionTypeStats = (questions = []) => {
  const stats = new Map();

  questions.forEach((item) => {
    const questionType = normalizeQuestionType(item.question_type);
    const current = stats.get(questionType) || {
      question_type: questionType,
      total_questions: 0,
      correct_count: 0,
      wrong_count: 0,
      total_score: 0,
      earned_score: 0,
    };
    current.total_questions += 1;
    current.correct_count += item.is_correct ? 1 : 0;
    current.wrong_count += item.is_correct ? 0 : 1;
    current.total_score += toNumber(item.points, 0);
    current.earned_score += toNumber(item.earned_score, 0);
    stats.set(questionType, current);
  });

  return Array.from(stats.values())
    .sort((left, right) => RESULT_TYPE_ORDER.indexOf(left.question_type) - RESULT_TYPE_ORDER.indexOf(right.question_type))
    .map((item) => ({
      ...item,
      total_score: roundTo(item.total_score, 2),
      earned_score: roundTo(item.earned_score, 2),
      accuracy_rate: item.total_questions > 0 ? roundTo((item.correct_count / item.total_questions) * 100, 2) : 0,
    }));
};

const buildResultReviewDetail = ({ resultRow, sessionRow, paperRow, answerRows = [], aiAdviceRow = null } = {}) => {
  const result = normalizeAdminResultListRow(resultRow || {});
  const questions = (Array.isArray(answerRows) ? answerRows : [])
    .map((item) => buildQuestionReviewRow(item))
    .sort((left, right) => left.sort_order - right.sort_order || left.question_id - right.question_id);

  const correctCount = questions.filter((item) => item.is_correct).length;
  const wrongCount = Math.max(0, questions.length - correctCount);

  return {
    summary: {
      ...result,
      result_id: result.id,
      paper_name: trimText(paperRow?.name) || `试卷#${result.paper_id || 0}`,
      user_position: trimText(resultRow?.user_position),
      user_department: trimText(resultRow?.user_department),
      username: trimText(resultRow?.username),
      pass_score: toNumber(paperRow?.pass_score, 0),
      duration_seconds: diffSeconds(sessionRow?.started_at, sessionRow?.submitted_at || sessionRow?.ended_at),
      created_at: resultRow?.created_at || '',
      submitted_at: sessionRow?.submitted_at || sessionRow?.ended_at || '',
    },
    report: {
      total_questions: questions.length,
      correct_count: correctCount,
      wrong_count: wrongCount,
      accuracy_rate: questions.length > 0 ? roundTo((correctCount / questions.length) * 100, 2) : 0,
      by_type: buildQuestionTypeStats(questions),
    },
    questions,
    ai_advice: normalizeAiAdvice(aiAdviceRow),
  };
};

const buildCandidateHistorySummary = (rows = []) => {
  const items = Array.isArray(rows) ? rows : [];
  const total = items.length;
  const passCount = items.filter((item) => toNumber(item?.passed, 0) === 1).length;
  const finalCount = items.filter((item) => toNumber(item?.is_final, 0) === 1).length;
  const scoreSum = items.reduce((sum, item) => sum + toNumber(item?.score, 0), 0);

  return {
    total_results: total,
    final_result_count: finalCount,
    pass_count: passCount,
    average_score: total > 0 ? roundTo(scoreSum / total, 2) : 0,
    latest_exam_at: items[0]?.created_at || '',
  };
};

const csvEscapeCell = (value) => {
  const text = String(value ?? '');
  if (!text) return '';
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const buildResultsExportCsv = (rows = []) => {
  const headers = [
    '结果ID',
    '考生',
    '部门',
    '试卷',
    '考试时间',
    '得分',
    '总分',
    '用时(秒)',
    '错题数',
    '第几次考试',
    '是否最终',
    '考试结果',
  ];
  const lines = [headers.join(',')];
  (Array.isArray(rows) ? rows : []).forEach((item) => {
    const row = normalizeAdminResultListRow(item);
    lines.push([
      row.id,
      trimText(item?.username),
      trimText(item?.user_department),
      trimText(item?.paper_name) || `试卷#${row.paper_id || 0}`,
      formatShanghaiDateTime(item?.created_at),
      row.score.toFixed(2),
      row.total_score.toFixed(2),
      row.duration_seconds,
      row.wrong_count,
      row.attempt_no,
      row.is_final === 1 ? '是' : '否',
      row.passed === 1 ? '通过' : '未通过',
    ].map(csvEscapeCell).join(','));
  });
  return `\uFEFF${lines.join('\n')}`;
};

module.exports = {
  buildResultsExportCsv,
  formatShanghaiDateTime,
  normalizeAdminResultsFilters,
  buildAdminResultsWhere,
  normalizeAdminResultListRow,
  normalizeAdminResultsSummary,
  buildResultReviewDetail,
  buildCandidateHistorySummary,
};
