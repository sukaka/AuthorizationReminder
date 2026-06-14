const planCallbackDeliveries = (subscriptions, deliveryStats) => {
  const statsByCallbackId = new Map(
    (Array.isArray(deliveryStats) ? deliveryStats : []).map((item) => [
      Number(item.callback_id),
      {
        attemptCount: Math.max(0, Number(item.attempt_count || 0)),
        succeeded: Number(item.succeeded || 0) === 1,
      },
    ])
  );
  const plan = {
    pending: [],
    succeeded: [],
    exhausted: [],
  };

  for (const subscription of Array.isArray(subscriptions) ? subscriptions : []) {
    const stats = statsByCallbackId.get(Number(subscription.id)) || {
      attemptCount: 0,
      succeeded: false,
    };
    const retryLimit = Math.max(1, Number(subscription.retry_limit || 1));
    const planned = {
      ...subscription,
      delivery_attempt_no: stats.attemptCount + 1,
    };

    if (stats.succeeded) {
      plan.succeeded.push(planned);
    } else if (stats.attemptCount >= retryLimit) {
      plan.exhausted.push(planned);
    } else {
      plan.pending.push(planned);
    }
  }

  return plan;
};

module.exports = {
  planCallbackDeliveries,
};
