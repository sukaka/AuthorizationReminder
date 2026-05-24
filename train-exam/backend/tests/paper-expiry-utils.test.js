const {
  buildPaperExamDeadline,
  isPaperExamExpired,
  normalizePaperExamWindowHours,
} = require('../src/paper-expiry-utils');

describe('paper expiry utils', () => {
  it('normalizes exam window hours with a 72 hour default', () => {
    expect(normalizePaperExamWindowHours(undefined)).toBe(72);
    expect(normalizePaperExamWindowHours('')).toBe(72);
    expect(normalizePaperExamWindowHours('1')).toBe(1);
    expect(normalizePaperExamWindowHours('9999')).toBe(8760);
  });

  it('calculates deadline from published time and configured hours', () => {
    expect(buildPaperExamDeadline({
      published_at: '2026-05-20 01:30:00',
      exam_window_hours: 72,
    })).toBe('2026-05-23 01:30:00');
  });

  it('detects papers expired after the configured exam window', () => {
    const paper = {
      published_at: '2026-05-20 01:30:00',
      exam_window_hours: 72,
    };
    expect(isPaperExamExpired(paper, { now: new Date('2026-05-23T01:30:00Z') })).toBe(true);
    expect(isPaperExamExpired(paper, { now: new Date('2026-05-23T01:29:59Z') })).toBe(false);
  });
});
