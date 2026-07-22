const toQuestionId = (row) => Number(row?.question_id || row?.id || 0);

const findDuplicateQuestionIds = (values = []) => {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const questionId = Number(value || 0);
    if (!Number.isInteger(questionId) || questionId <= 0) continue;
    if (seen.has(questionId)) duplicates.add(questionId);
    seen.add(questionId);
  }
  return [...duplicates];
};

const dedupeQuestionSnapshots = (snapshots = []) => {
  const seen = new Set();
  return (Array.isArray(snapshots) ? snapshots : []).filter((snapshot) => {
    const questionId = toQuestionId(snapshot);
    if (!questionId || seen.has(questionId)) return false;
    seen.add(questionId);
    return true;
  });
};

const selectUniqueQuestionsByRules = async ({
  rules = [],
  fetchCandidates,
  isEligible = () => true,
  shuffleCandidates = (items) => items,
} = {}) => {
  if (typeof fetchCandidates !== 'function') throw new TypeError('fetchCandidates must be a function');

  const selectedIds = new Set();
  const selections = [];

  for (const rule of Array.isArray(rules) ? rules : []) {
    let remaining = Math.max(1, Number(rule?.question_count || 1));
    const attemptedIds = new Set();

    while (remaining > 0) {
      const excludedIds = new Set([...selectedIds, ...attemptedIds]);
      const limit = Math.max(20, remaining * 5);
      const candidates = await fetchCandidates(rule, { excludedIds, limit });
      const freshCandidates = (Array.isArray(candidates) ? candidates : []).filter((candidate) => {
        const questionId = toQuestionId(candidate);
        return questionId > 0 && !attemptedIds.has(questionId);
      });

      if (!freshCandidates.length) break;
      freshCandidates.forEach((candidate) => attemptedIds.add(toQuestionId(candidate)));

      const eligible = shuffleCandidates(
        freshCandidates.filter((candidate) => isEligible(candidate, rule))
      );
      const chosen = eligible.slice(0, remaining);
      for (const row of chosen) {
        const questionId = toQuestionId(row);
        if (!questionId || selectedIds.has(questionId)) continue;
        selectedIds.add(questionId);
        selections.push({ row, rule });
        remaining -= 1;
      }

      if (!chosen.length && freshCandidates.length < limit) break;
    }
  }

  return selections;
};

module.exports = {
  dedupeQuestionSnapshots,
  findDuplicateQuestionIds,
  selectUniqueQuestionsByRules,
};
