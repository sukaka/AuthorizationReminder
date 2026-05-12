import { describe, expect, it } from 'vitest';

import examSessionUtils from '../src/exam-session-utils.js';

const {
  shouldResumeExistingExamSession,
} = examSessionUtils;

describe('exam-session-utils', () => {
  it('resumes existing started session when it has not expired yet', () => {
    expect(shouldResumeExistingExamSession({
      session: {
        status: 'started',
        started_at: '2099-01-01T10:00:00Z',
        duration_minutes: 60,
      },
      now: new Date('2099-01-01T10:20:00Z'),
    })).toBe(true);
  });

  it('does not resume submitted or timeout sessions', () => {
    expect(shouldResumeExistingExamSession({
      session: {
        status: 'submitted',
        started_at: '2099-01-01T10:00:00Z',
        duration_minutes: 60,
      },
      now: new Date('2099-01-01T10:20:00Z'),
    })).toBe(false);

    expect(shouldResumeExistingExamSession({
      session: {
        status: 'timeout',
        started_at: '2099-01-01T10:00:00Z',
        duration_minutes: 60,
      },
      now: new Date('2099-01-01T10:20:00Z'),
    })).toBe(false);
  });

  it('does not resume expired started sessions', () => {
    expect(shouldResumeExistingExamSession({
      session: {
        status: 'started',
        started_at: '2099-01-01T10:00:00Z',
        duration_minutes: 30,
      },
      now: new Date('2099-01-01T10:31:00Z'),
    })).toBe(false);
  });
});
