const {
  buildInstructorReviewSummary,
  canUserReviewCourse,
  normalizeInstructorReviewInput,
  normalizeInstructorReviewStatus,
} = require('../src/instructor-review-utils');

describe('instructor review utils', () => {
  it('normalizes review input scores and feedback', () => {
    expect(normalizeInstructorReviewInput({
      rating: '5',
      clarity_score: '4',
      interaction_score: '3',
      practical_score: '2',
      pace_score: '1',
      qa_score: '7',
      feedback: ' 讲得清楚，案例实用 ',
      anonymous: 'true',
    })).toEqual({
      rating: 5,
      clarity_score: 4,
      interaction_score: 3,
      practical_score: 2,
      pace_score: 1,
      qa_score: 5,
      feedback: '讲得清楚，案例实用',
      anonymous: 1,
    });
  });

  it('normalizes admin review statuses', () => {
    expect(normalizeInstructorReviewStatus('resolved')).toBe('resolved');
    expect(normalizeInstructorReviewStatus('已处理')).toBe('resolved');
    expect(normalizeInstructorReviewStatus('pending')).toBe('pending');
    expect(normalizeInstructorReviewStatus('unknown')).toBe('pending');
  });

  it('allows course review after enrollment or learning progress', () => {
    expect(canUserReviewCourse({ enrollment: { id: 1 }, progressCount: 0 })).toBe(true);
    expect(canUserReviewCourse({ enrollment: null, progressCount: 2 })).toBe(true);
    expect(canUserReviewCourse({ enrollment: null, progressCount: 0 })).toBe(false);
  });

  it('builds admin instructor review summary', () => {
    expect(buildInstructorReviewSummary([
      { rating: 5, status: 'resolved', instructor_name: '张老师', clarity_score: 5, interaction_score: 4, practical_score: 5, pace_score: 4, qa_score: 5 },
      { rating: 4, status: 'pending', instructor_name: '张老师', clarity_score: 4, interaction_score: 4, practical_score: 4, pace_score: 3, qa_score: 4 },
      { rating: 3, status: 'pending', instructor_name: '李老师', clarity_score: 3, interaction_score: 3, practical_score: 4, pace_score: 3, qa_score: 3 },
    ])).toEqual({
      total_reviews: 3,
      pending_count: 2,
      resolved_count: 1,
      average_rating: 4,
      excellent_instructor_count: 1,
      dimensions: {
        clarity_score: 4,
        interaction_score: 3.67,
        practical_score: 4.33,
        pace_score: 3.33,
        qa_score: 4,
      },
    });
  });
});
