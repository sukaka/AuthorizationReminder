const trimText = (value) => String(value || '').trim();

const isBasicViewerRole = (role) => {
  const key = trimText(role).toLowerCase();
  return key === 'viewer' || key === 'user';
};

const BASIC_VIEWER_ALLOWED_APIS = [
  { method: 'GET', pattern: /^\/api\/auth\/me$/ },
  { method: 'GET', pattern: /^\/api\/train-exam\/auth\/me$/ },
  { method: 'GET', pattern: /^\/api\/train-exam\/csrf$/ },
  { method: 'GET', pattern: /^\/api\/train-exam\/settings$/ },
  { method: 'GET', pattern: /^\/api\/train-exam\/courses$/ },
  { method: 'GET', pattern: /^\/api\/train-exam\/courses\/\d+$/ },
  { method: 'GET', pattern: /^\/api\/train-exam\/courses\/\d+\/learning-path$/ },
  { method: 'GET', pattern: /^\/api\/train-exam\/my\/learning-progress$/ },
  { method: 'GET', pattern: /^\/api\/train-exam\/resources\/\d+\/playability$/ },
  { method: 'GET', pattern: /^\/api\/train-exam\/resources\/\d+\/transcode-status$/ },
  { method: 'GET', pattern: /^\/api\/train-exam\/resources\/\d+\/stream$/ },
  { method: 'GET', pattern: /^\/api\/train-exam\/resources\/\d+\/download$/ },
  { method: 'GET', pattern: /^\/api\/train-exam\/resources\/\d+\/doc-preview-config$/ },
  { method: 'GET', pattern: /^\/api\/train-exam\/resources\/\d+\/doc-preview-file$/ },
  { method: 'POST', pattern: /^\/api\/train-exam\/resources\/\d+\/progress$/ },
  { method: 'GET', pattern: /^\/api\/train-exam\/papers$/ },
  { method: 'POST', pattern: /^\/api\/train-exam\/papers\/\d+\/exam\/start$/ },
  { method: 'GET', pattern: /^\/api\/train-exam\/exam-sessions\/\d+$/ },
  { method: 'POST', pattern: /^\/api\/train-exam\/exam-sessions\/\d+\/answers$/ },
  { method: 'POST', pattern: /^\/api\/train-exam\/exam-sessions\/\d+\/focus-switch$/ },
  { method: 'POST', pattern: /^\/api\/train-exam\/exam-sessions\/\d+\/submit$/ },
  { method: 'GET', pattern: /^\/api\/train-exam\/exam-sessions\/\d+\/result$/ },
  { method: 'GET', pattern: /^\/api\/train-exam\/my\/results$/ },
  { method: 'GET', pattern: /^\/api\/train-exam\/my\/results\/export\.csv$/ },
  { method: 'GET', pattern: /^\/api\/train-exam\/my\/instructor-review-forms$/ },
  { method: 'POST', pattern: /^\/api\/train-exam\/instructor-review-forms\/\d+\/response$/ },
  { method: 'PUT', pattern: /^\/api\/train-exam\/instructor-review-forms\/\d+\/response$/ },
  { method: 'GET', pattern: /^\/api\/train-exam\/results\/\d+$/ },
  { method: 'GET', pattern: /^\/api\/train-exam\/results\/\d+\/review-detail$/ },
];

const isBasicViewerApiAllowed = ({ method = 'GET', path = '' } = {}) => {
  const upperMethod = trimText(method).toUpperCase();
  if (upperMethod === 'OPTIONS') return true;
  const fullPath = trimText(String(path || '').split('?')[0]);
  if (!fullPath) return false;
  return BASIC_VIEWER_ALLOWED_APIS.some((item) => item.method === upperMethod && item.pattern.test(fullPath));
};

module.exports = {
  BASIC_VIEWER_ALLOWED_APIS,
  isBasicViewerApiAllowed,
  isBasicViewerRole,
};
