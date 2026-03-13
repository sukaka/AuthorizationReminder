const trimText = (value) => String(value || '').trim();

const normalizeUserAnswerValues = (value) => {
  if (Array.isArray(value)) return value.map((item) => trimText(item)).filter(Boolean);
  if (value && typeof value === 'object') {
    if (Array.isArray(value.values)) return value.values.map((item) => trimText(item)).filter(Boolean);
    if (value.value !== undefined) return [trimText(value.value)].filter(Boolean);
  }
  const text = trimText(value);
  if (!text) return [];
  return text.split(/[，,、\s]+/).map((item) => trimText(item)).filter(Boolean);
};

const normalizeAnswerToken = (value) => trimText(value).toLowerCase();

const normalizeMultipleChoiceAnswerValues = (value) => {
  const source = Array.isArray(value) ? value : normalizeUserAnswerValues(value);
  const expanded = source.flatMap((item) => {
    const token = trimText(item).toUpperCase();
    if (!token) return [];
    if (/^[A-Z]{2,}$/.test(token)) return token.split('');
    return [token];
  });
  return Array.from(new Set(expanded));
};

const evaluateAnswer = ({ snapshot, standardAnswer, userAnswer }) => {
  const qType = String(snapshot?.question_type || 'single_choice').trim().toLowerCase() || 'single_choice';
  const points = Number(snapshot?.points || 0);
  const userValuesRaw = normalizeUserAnswerValues(userAnswer);

  let isCorrect = false;

  if (qType === 'fill_blank') {
    const stdValues = Array.isArray(standardAnswer?.answer_values)
      ? standardAnswer.answer_values.map((item) => normalizeAnswerToken(item)).filter(Boolean)
      : [];
    const userValues = userValuesRaw.map((item) => normalizeAnswerToken(item)).filter(Boolean);
    const answerText = normalizeAnswerToken(standardAnswer?.answer_text);
    const aliases = Array.isArray(standardAnswer?.answer_aliases)
      ? standardAnswer.answer_aliases.map((item) => normalizeAnswerToken(item)).filter(Boolean)
      : [];
    const expected = Array.from(new Set([answerText, ...aliases, ...stdValues].filter(Boolean)));
    if (userValues.length) {
      isCorrect = expected.includes(userValues[0]);
    }
  } else if (qType === 'multiple_choice') {
    const sortedStd = normalizeMultipleChoiceAnswerValues(standardAnswer?.answer_values)
      .map((item) => normalizeAnswerToken(item))
      .sort();
    const sortedUser = normalizeMultipleChoiceAnswerValues(userValuesRaw)
      .map((item) => normalizeAnswerToken(item))
      .sort();
    isCorrect = sortedStd.length > 0 && sortedStd.length === sortedUser.length && sortedStd.every((val, idx) => val === sortedUser[idx]);
  } else {
    const stdValues = Array.isArray(standardAnswer?.answer_values)
      ? standardAnswer.answer_values.map((item) => normalizeAnswerToken(item)).filter(Boolean)
      : [];
    const userValues = userValuesRaw.map((item) => normalizeAnswerToken(item)).filter(Boolean);
    const expected = stdValues[0] || '';
    let user = userValues[0] || '';
    if (qType === 'judgement') {
      if (['a', '正确', '对', 'true', 't', '1'].includes(user)) user = 'true';
      if (['b', '错误', '错', 'false', 'f', '0'].includes(user)) user = 'false';
      let normalizedExpected = expected;
      if (['a', '正确', '对', 'true', 't', '1'].includes(normalizedExpected)) normalizedExpected = 'true';
      if (['b', '错误', '错', 'false', 'f', '0'].includes(normalizedExpected)) normalizedExpected = 'false';
      isCorrect = !!user && user === normalizedExpected;
    } else {
      isCorrect = !!user && user === expected;
    }
  }

  return {
    isCorrect,
    earnedScore: isCorrect ? points : 0,
  };
};

module.exports = {
  evaluateAnswer,
  normalizeMultipleChoiceAnswerValues,
  normalizeUserAnswerValues,
};
