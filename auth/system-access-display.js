const SYSTEM_DISPLAY_OPTIONS = Object.freeze([
  { key: 'reminder', label: '授权到期提醒系统', shortLabel: '提醒系统' },
  { key: 'ticketing', label: '工单管理系统', shortLabel: '工单系统' },
  { key: 'cmdb', label: 'CMDB系统', shortLabel: 'CMDB系统' },
  { key: 'inventory', label: '库存管理系统', shortLabel: '库存管理系统' },
  { key: 'device-flow', label: '设备流转系统', shortLabel: '设备流转系统' },
  { key: 'sec-impl', label: '聚信实施记录系统', shortLabel: '聚信实施记录系统' },
  { key: 'faq', label: 'FAQ系统', shortLabel: 'FAQ系统' },
  { key: 'tender', label: '标书协同制作系统', shortLabel: '标书协同制作系统' },
  { key: 'train-exam', label: '培训考试系统', shortLabel: '培训考试系统' },
  { key: 'admin-center', label: '管理中心', shortLabel: '管理中心' },
  { key: 'audit-center', label: '审计中心', shortLabel: '审计中心' },
]);

const getSystemDisplayOption = (key) => SYSTEM_DISPLAY_OPTIONS.find((item) => item.key === String(key || '').trim());

const getSystemDisplayLabel = (key) => {
  const item = getSystemDisplayOption(key);
  return item?.label || key || '-';
};

const getSystemDisplayShortLabel = (key) => {
  const item = getSystemDisplayOption(key);
  return item?.shortLabel || item?.label || key || '-';
};

const summarizeSystemAccess = (keys, maxVisible = 2) => {
  const labels = Array.isArray(keys)
    ? keys.map((key) => getSystemDisplayShortLabel(key)).filter(Boolean)
    : [];
  return {
    labels: labels.slice(0, maxVisible),
    overflowCount: Math.max(labels.length - maxVisible, 0),
  };
};

module.exports = {
  SYSTEM_DISPLAY_OPTIONS,
  getSystemDisplayLabel,
  getSystemDisplayShortLabel,
  summarizeSystemAccess,
};
