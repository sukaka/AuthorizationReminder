const toCount = (value) => {
  const count = Number(value || 0);
  return Number.isFinite(count) && count > 0 ? count : 0;
};

const normalizeQuestionCategoryRow = (item = {}) => ({
  ...item,
  id: Number(item.id || 0),
  is_system: Number(item.is_system || 0),
  question_count: toCount(item.question_count),
  published_question_count: toCount(item.published_question_count),
  published_single_choice_count: toCount(item.published_single_choice_count),
  published_multiple_choice_count: toCount(item.published_multiple_choice_count),
  published_judgement_count: toCount(item.published_judgement_count),
  published_fill_blank_count: toCount(item.published_fill_blank_count),
});

module.exports = {
  normalizeQuestionCategoryRow,
};
