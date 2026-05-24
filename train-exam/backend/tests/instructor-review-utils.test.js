const {
  buildInstructorReviewQuestionnaireSummary,
  isScheduledInstructorReviewDue,
  normalizeInstructorQuestionnaireInput,
  normalizeInstructorReviewResponseInput,
  normalizeInstructorReviewStatus,
} = require('../src/instructor-review-utils');

describe('instructor review questionnaire utils', () => {
  it('normalizes questionnaire metadata', () => {
    expect(normalizeInstructorQuestionnaireInput({
      title: '  线下培训讲师评价 ',
      instructor_name: ' 王老师 ',
      description: '  第一期线下课 ',
      status: 'published',
    })).toEqual({
      title: '线下培训讲师评价',
      instructor_name: '王老师',
      description: '第一期线下课',
      status: 'published',
    });
  });

  it('normalizes five dimension scores and computes final score text', () => {
    expect(normalizeInstructorReviewResponseInput({
      clarity_score: '5',
      interaction_score: '4',
      practical_score: '4',
      time_control_score: '3',
      qa_score: '4',
      feedback: '  案例很实用 ',
      anonymous: 'true',
    })).toEqual({
      clarity_score: 5,
      interaction_score: 4,
      practical_score: 4,
      time_control_score: 3,
      qa_score: 4,
      final_score: 4,
      rating_label: '优秀',
      feedback: '案例很实用',
      anonymous: 1,
    });
  });

  it('maps rounded final scores to rating labels', () => {
    expect(normalizeInstructorReviewResponseInput({
      clarity_score: 5,
      interaction_score: 5,
      practical_score: 5,
      time_control_score: 5,
      qa_score: 5,
    }).rating_label).toBe('极好');
    expect(normalizeInstructorReviewResponseInput({
      clarity_score: 1,
      interaction_score: 1,
      practical_score: 1,
      time_control_score: 1,
      qa_score: 1,
    }).rating_label).toBe('极差');
  });

  it('normalizes questionnaire status', () => {
    expect(normalizeInstructorReviewStatus('published')).toBe('published');
    expect(normalizeInstructorReviewStatus('scheduled')).toBe('scheduled');
    expect(normalizeInstructorReviewStatus('closed')).toBe('closed');
    expect(normalizeInstructorReviewStatus('草稿')).toBe('draft');
    expect(normalizeInstructorReviewStatus('unknown')).toBe('draft');
  });

  it('detects scheduled instructor reviews that are due for publication', () => {
    expect(isScheduledInstructorReviewDue({
      status: 'scheduled',
      scheduled_publish_at: '2026-05-24 02:00:00',
    }, { now: new Date('2026-05-24T02:00:00Z') })).toBe(true);

    expect(isScheduledInstructorReviewDue({
      status: 'scheduled',
      scheduled_publish_at: '2026-05-24 02:01:00',
    }, { now: new Date('2026-05-24T02:00:00Z') })).toBe(false);

    expect(isScheduledInstructorReviewDue({
      status: 'draft',
      scheduled_publish_at: '2026-05-24 01:00:00',
    }, { now: new Date('2026-05-24T02:00:00Z') })).toBe(false);
  });

  it('builds questionnaire summary by responses', () => {
    expect(buildInstructorReviewQuestionnaireSummary([
      { final_score: 5, clarity_score: 5, interaction_score: 5, practical_score: 5, time_control_score: 5, qa_score: 5 },
      { final_score: 4, clarity_score: 4, interaction_score: 4, practical_score: 4, time_control_score: 4, qa_score: 4 },
      { final_score: 3, clarity_score: 3, interaction_score: 3, practical_score: 3, time_control_score: 3, qa_score: 3 },
    ])).toEqual({
      response_count: 3,
      average_final_score: 4,
      rating_distribution: {
        极好: 1,
        优秀: 1,
        普通: 1,
        一般: 0,
        极差: 0,
      },
      dimensions: {
        clarity_score: 4,
        interaction_score: 4,
        practical_score: 4,
        time_control_score: 4,
        qa_score: 4,
      },
    });
  });
});
