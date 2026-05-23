const toPositiveInt = (value, fallback = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.floor(num));
};

const hasAvailableRetakeOpportunity = (opportunity) => {
  if (!opportunity) return false;
  const remaining = toPositiveInt(opportunity.remaining_count);
  const consumed = toPositiveInt(opportunity.consumed_count);
  return remaining > consumed;
};

const resolveRetakeStartPermission = ({ doneAttempts, maxAttempts, availableOpportunity } = {}) => {
  const attempts = toPositiveInt(doneAttempts);
  const limit = Math.max(1, toPositiveInt(maxAttempts, 1));
  const attemptNo = attempts + 1;
  if (attempts < limit) {
    return {
      allowed: true,
      attemptNo,
      retakeOpportunityId: 0,
    };
  }
  if (hasAvailableRetakeOpportunity(availableOpportunity)) {
    return {
      allowed: true,
      attemptNo,
      retakeOpportunityId: toPositiveInt(availableOpportunity.id),
    };
  }
  return {
    allowed: false,
    attemptNo,
    retakeOpportunityId: 0,
  };
};

const shouldKeepFinalResultAfterDelete = ({ deletedWasFinal } = {}) => !deletedWasFinal;

module.exports = {
  hasAvailableRetakeOpportunity,
  resolveRetakeStartPermission,
  shouldKeepFinalResultAfterDelete,
};
