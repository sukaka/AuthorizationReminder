import { describe, expect, it } from 'vitest';

import examAnswerUtils from '../src/exam-answer-utils.js';

const {
  evaluateAnswer,
  normalizeMultipleChoiceAnswerValues,
} = examAnswerUtils;

describe('exam-answer-utils', () => {
  it('splits compact multiple choice answers into individual option keys', () => {
    expect(normalizeMultipleChoiceAnswerValues(['AB'])).toEqual(['A', 'B']);
    expect(normalizeMultipleChoiceAnswerValues('AC')).toEqual(['A', 'C']);
  });

  it('treats compact standard answers as correct when user selects the same option set', () => {
    const result = evaluateAnswer({
      snapshot: { question_type: 'multiple_choice', points: 1 },
      standardAnswer: { answer_values: ['AB'] },
      userAnswer: ['A', 'B'],
    });

    expect(result).toEqual({
      isCorrect: true,
      earnedScore: 1,
    });
  });
});
