import { describe, expect, it } from 'vitest';

import retakeOpportunityUtils from '../src/retake-opportunity-utils.js';

const {
  resolveRetakeStartPermission,
  shouldKeepFinalResultAfterDelete,
} = retakeOpportunityUtils;

describe('retake-opportunity-utils', () => {
  it('allows a new attempt after max attempts only when a retake opportunity exists', () => {
    expect(resolveRetakeStartPermission({
      doneAttempts: 3,
      maxAttempts: 3,
      availableOpportunity: { id: 12, remaining_count: 1, consumed_count: 0 },
    })).toEqual({
      allowed: true,
      attemptNo: 4,
      retakeOpportunityId: 12,
    });

    expect(resolveRetakeStartPermission({
      doneAttempts: 3,
      maxAttempts: 3,
      availableOpportunity: null,
    })).toEqual({
      allowed: false,
      attemptNo: 4,
      retakeOpportunityId: 0,
    });
  });

  it('keeps normal attempts unchanged before max attempts are reached', () => {
    expect(resolveRetakeStartPermission({
      doneAttempts: 1,
      maxAttempts: 3,
      availableOpportunity: { id: 12, remaining_count: 1, consumed_count: 0 },
    })).toEqual({
      allowed: true,
      attemptNo: 2,
      retakeOpportunityId: 0,
    });
  });

  it('does not promote an older score when deleting the final score', () => {
    expect(shouldKeepFinalResultAfterDelete({ deletedWasFinal: true })).toBe(false);
    expect(shouldKeepFinalResultAfterDelete({ deletedWasFinal: false })).toBe(true);
  });
});
