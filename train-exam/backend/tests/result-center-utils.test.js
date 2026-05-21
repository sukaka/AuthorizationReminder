const {
  buildResultsExportCsv,
  calculateExamRating,
  normalizeAdminResultPaperSummaryRow,
  normalizeAdminResultsFilters,
  buildAdminResultsWhere,
  normalizeAdminResultListRow,
  normalizeAdminResultsSummary,
  buildResultReviewDetail,
  buildCandidateHistorySummary,
  buildOverallEvaluation,
} = require('../src/result-center-utils');

describe('result center utils', () => {
  it('calculates exam ratings from score rate boundaries', () => {
    expect(calculateExamRating(90, 100)).toEqual({ rating_level: 'A', rating_rate: 90 });
    expect(calculateExamRating(80, 100)).toEqual({ rating_level: 'B', rating_rate: 80 });
    expect(calculateExamRating(60, 100)).toEqual({ rating_level: 'C', rating_rate: 60 });
    expect(calculateExamRating(59.99, 100)).toEqual({ rating_level: 'D', rating_rate: 59.99 });
    expect(calculateExamRating(10, 0)).toEqual({ rating_level: 'D', rating_rate: 0 });
  });

  it('normalizes admin result filters with defaults and aliases', () => {
    expect(normalizeAdminResultsFilters({
      keyword: ' 张三 ',
      user_id: '12',
      paper_id: '9',
      passed: 'passed',
      final_only: 'true',
      date_from: '2026-03-01',
      date_to: '2026-03-31',
      page: '3',
      limit: '55',
    })).toEqual({
      keyword: '张三',
      user_id: 12,
      paper_id: 9,
      passed: 1,
      final_only: true,
      date_from: '2026-03-01',
      date_to: '2026-03-31',
      page: 3,
      limit: 55,
    });

    expect(normalizeAdminResultsFilters({
      passed: 'all',
      final_only: '0',
      page: '0',
      limit: '-1',
    })).toEqual({
      keyword: '',
      user_id: 0,
      paper_id: 0,
      passed: '',
      final_only: false,
      date_from: '',
      date_to: '',
      page: 1,
      limit: 20,
    });
  });

  it('builds stable where clause for admin result filters', () => {
    expect(buildAdminResultsWhere({
      keyword: '张三',
      user_id: 12,
      paper_id: 9,
      passed: 1,
      final_only: true,
      date_from: '2026-03-01',
      date_to: '2026-03-31',
    })).toEqual({
      whereSql: 'WHERE (r.username LIKE ? OR IFNULL(r.user_department, \'\') LIKE ? OR IFNULL(p.name, \'\') LIKE ?) AND r.user_id = ? AND r.paper_id = ? AND r.passed = ? AND r.is_final = 1 AND r.created_at >= ? AND r.created_at < ?',
      params: ['%张三%', '%张三%', '%张三%', 12, 9, 1, '2026-03-01 00:00:00', '2026-04-01 00:00:00'],
    });
  });

  it('normalizes summary rows and result list rows', () => {
    expect(normalizeAdminResultListRow({
      id: '8',
      user_id: '5',
      paper_id: '2',
      score: '82.5',
      total_score: '100',
      passed: '1',
      attempt_no: '3',
      is_final: '0',
      duration_seconds: '780',
      wrong_count: '4',
    })).toMatchObject({
      id: 8,
      user_id: 5,
      paper_id: 2,
      score: 82.5,
      total_score: 100,
      passed: 1,
      attempt_no: 3,
      is_final: 0,
      duration_seconds: 780,
      wrong_count: 4,
      rating_level: 'B',
      rating_rate: 82.5,
    });

    expect(normalizeAdminResultsSummary({
      total_results: '18',
      pass_count: '11',
      fail_count: '7',
      average_score: '76.2',
      average_duration_seconds: '930',
      final_result_count: '9',
    })).toEqual({
      total_results: 18,
      pass_count: 11,
      fail_count: 7,
      average_score: 76.2,
      average_duration_seconds: 930,
      final_result_count: 9,
      pass_rate: 61.11,
    });
  });

  it('builds results export csv with localized headers and rows', () => {
    const csv = buildResultsExportCsv([
      {
        id: 18,
        username: '张三',
        user_department: '生产部',
        paper_name: '安全生产考试',
        created_at: '2026-04-17 03:14:33',
        score: 86.5,
        total_score: 100,
        duration_seconds: 930,
        wrong_count: 3,
        attempt_no: 2,
        is_final: 1,
        passed: 1,
      },
    ]);

    expect(csv).toContain('结果ID,考生,部门,试卷,考试时间,得分,总分,评级,用时(秒),错题数,第几次考试,是否最终,考试结果');
    expect(csv).toContain('18,张三,生产部,安全生产考试,2026-04-17 11:14:33,86.50,100.00,B,930,3,2,是,通过');
  });

  it('normalizes admin paper result summary rows with rating distribution', () => {
    expect(normalizeAdminResultPaperSummaryRow({
      paper_id: '7',
      paper_name: '安全生产考试',
      status: 'published',
      result_total: '5',
      candidate_total: '3',
      final_result_count: '2',
      pass_count: '4',
      average_score: '83.334',
      latest_result_at: '2026-04-17 03:14:33',
      rating_a_count: '1',
      rating_b_count: '2',
      rating_c_count: '1',
      rating_d_count: '1',
    })).toEqual({
      paper_id: 7,
      paper_name: '安全生产考试',
      status: 'published',
      result_total: 5,
      candidate_total: 3,
      final_result_count: 2,
      pass_count: 4,
      pass_rate: 80,
      average_score: 83.33,
      latest_result_at: '2026-04-17 03:14:33',
      rating_distribution: {
        A: 1,
        B: 2,
        C: 1,
        D: 1,
      },
    });
  });

  it('builds review detail payload with grouped report stats', () => {
    const payload = buildResultReviewDetail({
      resultRow: {
        id: '18',
        session_id: '33',
        paper_id: '7',
        user_id: '12',
        username: '张三',
        user_department: '生产部',
        user_position: '班长',
        score: '6',
        total_score: '8',
        passed: '1',
        attempt_no: '2',
        is_final: '1',
        created_at: '2026-03-10 10:00:00',
      },
      sessionRow: {
        id: '33',
        started_at: '2026-03-10 09:50:00',
        submitted_at: '2026-03-10 10:00:00',
        duration_minutes: '30',
      },
      paperRow: {
        id: '7',
        name: '安全生产考试',
        pass_score: '6',
      },
      answerRows: [
        {
          question_id: '101',
          sort_order: '1',
          is_correct: '1',
          earned_score: '2',
          question_snapshot_json: JSON.stringify({
            stem: '第一题',
            question_type: 'single_choice',
            points: 2,
            explanation: '解析1',
            options: [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }],
          }),
          user_answer_json: JSON.stringify(['A']),
          standard_answer_json: JSON.stringify({ answer_values: ['A'] }),
        },
        {
          question_id: '102',
          sort_order: '2',
          is_correct: '0',
          earned_score: '0',
          question_snapshot_json: JSON.stringify({
            stem: '第二题',
            question_type: 'judgement',
            points: 2,
            explanation: '解析2',
            options: [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }],
          }),
          user_answer_json: JSON.stringify(['B']),
          standard_answer_json: JSON.stringify({ answer_values: ['A'] }),
        },
        {
          question_id: '103',
          sort_order: '3',
          is_correct: '1',
          earned_score: '4',
          question_snapshot_json: JSON.stringify({
            stem: '第三题',
            question_type: 'multiple_choice',
            points: 4,
            explanation: '解析3',
            options: [{ key: 'A', text: '一' }, { key: 'B', text: '二' }],
          }),
          user_answer_json: JSON.stringify(['A', 'B']),
          standard_answer_json: JSON.stringify({ answer_values: ['A', 'B'] }),
        },
      ],
      aiAdviceRow: {
        id: '5',
        status: 'ready',
        advice_text: '注意判断题复盘',
        model_name: 'kimi',
        updated_at: '2026-03-10 10:01:00',
      },
    });

    expect(payload.summary).toMatchObject({
      result_id: 18,
      session_id: 33,
      paper_id: 7,
      paper_name: '安全生产考试',
      user_id: 12,
      username: '张三',
      user_department: '生产部',
      user_position: '班长',
      score: 6,
      total_score: 8,
      passed: 1,
      attempt_no: 2,
      is_final: 1,
      pass_score: 6,
      duration_seconds: 600,
    });
    expect(payload.report).toEqual({
      total_questions: 3,
      correct_count: 2,
      wrong_count: 1,
      accuracy_rate: 66.67,
      by_type: [
        {
          question_type: 'single_choice',
          total_questions: 1,
          correct_count: 1,
          wrong_count: 0,
          total_score: 2,
          earned_score: 2,
          accuracy_rate: 100,
        },
        {
          question_type: 'multiple_choice',
          total_questions: 1,
          correct_count: 1,
          wrong_count: 0,
          total_score: 4,
          earned_score: 4,
          accuracy_rate: 100,
        },
        {
          question_type: 'judgement',
          total_questions: 1,
          correct_count: 0,
          wrong_count: 1,
          total_score: 2,
          earned_score: 0,
          accuracy_rate: 0,
        },
      ],
    });
    expect(payload.questions[1]).toMatchObject({
      question_id: 102,
      sort_order: 2,
      stem: '第二题',
      question_type: 'judgement',
      points: 2,
      earned_score: 0,
      is_correct: false,
    });
    expect(payload.ai_advice).toMatchObject({
      id: 5,
      status: 'ready',
      advice_text: '注意判断题复盘',
      model_name: 'kimi',
    });
  });

  it('builds candidate history summary from result rows', () => {
    expect(buildCandidateHistorySummary([
      { score: 88, passed: 1, is_final: 1, created_at: '2026-03-10 10:00:00' },
      { score: 72, passed: 0, is_final: 0, created_at: '2026-03-08 08:00:00' },
      { score: 92, passed: 1, is_final: 1, created_at: '2026-03-05 09:00:00' },
    ])).toEqual({
      total_results: 3,
      final_result_count: 2,
      pass_count: 2,
      average_score: 84,
      latest_exam_at: '2026-03-10 10:00:00',
    });
  });

  it('builds overall evaluation from multiple exams and course ratings', () => {
    expect(buildOverallEvaluation({
      resultRows: [
        { score: 85, total_score: 100 },
        { score: 72, total_score: 90 },
      ],
      courseReviews: [
        { rating: 5 },
        { rating: 4 },
      ],
    })).toEqual({
      exam_count: 2,
      course_review_count: 2,
      exam_average_rate: 82.5,
      course_average_rating: 4.5,
      course_average_rate: 90,
      overall_score: 84.75,
      rating_level: 'B',
      evaluation_text: '整体表现良好，考试成绩和课程反馈较稳定，建议继续巩固薄弱知识点。',
    });
  });

  it('builds overall evaluation from course ratings when no exam exists', () => {
    expect(buildOverallEvaluation({
      resultRows: [],
      courseReviews: [{ rating: 3 }],
    })).toMatchObject({
      exam_count: 0,
      course_review_count: 1,
      exam_average_rate: 0,
      course_average_rating: 3,
      course_average_rate: 60,
      overall_score: 60,
      rating_level: 'C',
    });
  });

  it('builds overall evaluation from exam rows when course ratings are not available yet', () => {
    expect(buildOverallEvaluation({
      resultRows: [
        { score: 92, total_score: 100 },
        { score: 84, total_score: 100 },
      ],
    })).toMatchObject({
      exam_count: 2,
      course_review_count: 0,
      exam_average_rate: 88,
      course_average_rating: 0,
      course_average_rate: 0,
      overall_score: 88,
      rating_level: 'B',
    });
  });
});
