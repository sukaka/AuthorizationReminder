const {
  isScheduledPaperDue,
  normalizeScheduledPublishAt,
  SCHEDULED_PAPER_STATUS,
} = require('../src/paper-schedule-utils');

describe('paper schedule publish helpers', () => {
  it('normalizes Shanghai local datetime input to stored UTC mysql datetime', () => {
    const now = new Date('2026-05-17T01:00:00.000Z');

    expect(normalizeScheduledPublishAt('2026-05-20T09:30', { now })).toBe('2026-05-20 01:30:00');
    expect(normalizeScheduledPublishAt('2026-05-20 09:30:45', { now })).toBe('2026-05-20 01:30:45');
  });

  it('rejects malformed or past schedule times', () => {
    const now = new Date('2026-05-17T01:00:00.000Z');

    expect(() => normalizeScheduledPublishAt('2026-02-30T09:30', { now })).toThrow('定时发布时间格式无效');
    expect(() => normalizeScheduledPublishAt('2026-05-17T08:59', { now })).toThrow('定时发布时间必须晚于当前时间');
  });

  it('detects scheduled papers that are due for publication', () => {
    const now = new Date('2026-05-20T01:30:00.000Z');

    expect(isScheduledPaperDue({
      status: SCHEDULED_PAPER_STATUS,
      scheduled_publish_at: '2026-05-20 01:30:00',
    }, { now })).toBe(true);
    expect(isScheduledPaperDue({
      status: SCHEDULED_PAPER_STATUS,
      scheduled_publish_at: '2026-05-20 01:31:00',
    }, { now })).toBe(false);
    expect(isScheduledPaperDue({
      status: 'draft',
      scheduled_publish_at: '2026-05-20 01:00:00',
    }, { now })).toBe(false);
  });
});
