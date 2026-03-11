const clampProgressPercent = (value) => {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, num));
};

const isProgressCompleted = ({ progressPercent, completedAt } = {}) =>
  !!completedAt || clampProgressPercent(progressPercent) >= 100;

const shouldEnforceManagedVideoForceWatch = ({ forceWatchEnabled, progressPercent, completedAt } = {}) =>
  !!forceWatchEnabled && !isProgressCompleted({ progressPercent, completedAt });

module.exports = {
  isProgressCompleted,
  shouldEnforceManagedVideoForceWatch,
};
