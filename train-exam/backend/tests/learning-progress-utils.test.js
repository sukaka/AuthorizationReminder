const {
  isProgressCompleted,
  shouldEnforceManagedVideoForceWatch,
} = require('../src/learning-progress-utils');

describe('learning progress utils', () => {
  it('treats 100 percent progress as completed even without completed_at', () => {
    expect(isProgressCompleted({ progressPercent: 100, completedAt: null })).toBe(true);
    expect(isProgressCompleted({ progressPercent: 99, completedAt: null })).toBe(false);
  });

  it('treats completed_at as completed even when percent is lower', () => {
    expect(isProgressCompleted({ progressPercent: 80, completedAt: '2026-03-12 12:00:00' })).toBe(true);
  });

  it('enforces force watch only before the chapter is completed', () => {
    expect(
      shouldEnforceManagedVideoForceWatch({
        forceWatchEnabled: true,
        progressPercent: 35,
        completedAt: null,
      })
    ).toBe(true);

    expect(
      shouldEnforceManagedVideoForceWatch({
        forceWatchEnabled: true,
        progressPercent: 100,
        completedAt: null,
      })
    ).toBe(false);

    expect(
      shouldEnforceManagedVideoForceWatch({
        forceWatchEnabled: true,
        progressPercent: 80,
        completedAt: '2026-03-12 12:00:00',
      })
    ).toBe(false);
  });
});
