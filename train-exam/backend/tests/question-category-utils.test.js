const { normalizeQuestionCategoryRow } = require('../src/question-category-utils');

describe('question category utils', () => {
  it('normalizes published question type counts', () => {
    expect(normalizeQuestionCategoryRow({
      id: '12',
      is_system: '1',
      question_count: '20',
      published_question_count: '12',
      published_single_choice_count: '5',
      published_multiple_choice_count: '4',
      published_judgement_count: '3',
      published_fill_blank_count: '0',
    })).toEqual({
      id: 12,
      is_system: 1,
      question_count: 20,
      published_question_count: 12,
      published_single_choice_count: 5,
      published_multiple_choice_count: 4,
      published_judgement_count: 3,
      published_fill_blank_count: 0,
    });
  });

  it('falls back to zero when type counts are missing', () => {
    expect(normalizeQuestionCategoryRow({
      id: '2',
      name: '十二条令',
    })).toEqual({
      id: 2,
      name: '十二条令',
      is_system: 0,
      question_count: 0,
      published_question_count: 0,
      published_single_choice_count: 0,
      published_multiple_choice_count: 0,
      published_judgement_count: 0,
      published_fill_blank_count: 0,
    });
  });
});
