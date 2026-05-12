const { buildResultsExportCsv } = require('../src/result-center-utils');

describe('result center timezone formatting', () => {
  it('exports exam time in Asia/Shanghai for stored UTC timestamps', () => {
    const csv = buildResultsExportCsv([
      {
        id: 1,
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

    expect(csv).toContain('1,张三,生产部,安全生产考试,2026-04-17 11:14:33,86.50,100.00,B,930,3,2,是,通过');
  });
});
