const test = require('node:test');
const assert = require('node:assert/strict');

const { planCallbackDeliveries } = require('../src/callback-delivery-policy');

test('does not redeliver a subscription that already succeeded', () => {
  const subscriptions = [
    { id: 11, retry_limit: 5 },
    { id: 12, retry_limit: 5 },
  ];
  const deliveryStats = [
    { callback_id: 11, attempt_count: 1, succeeded: 1 },
    { callback_id: 12, attempt_count: 1, succeeded: 0 },
  ];

  const plan = planCallbackDeliveries(subscriptions, deliveryStats);

  assert.deepEqual(
    plan.pending.map((item) => item.id),
    [12]
  );
  assert.deepEqual(
    plan.succeeded.map((item) => item.id),
    [11]
  );
  assert.deepEqual(plan.exhausted, []);
});

test('marks a failed subscription exhausted at its own retry limit', () => {
  const subscriptions = [
    { id: 21, retry_limit: 2 },
    { id: 22, retry_limit: 5 },
  ];
  const deliveryStats = [
    { callback_id: 21, attempt_count: 2, succeeded: 0 },
    { callback_id: 22, attempt_count: 2, succeeded: 0 },
  ];

  const plan = planCallbackDeliveries(subscriptions, deliveryStats);

  assert.deepEqual(
    plan.pending.map((item) => item.id),
    [22]
  );
  assert.deepEqual(
    plan.exhausted.map((item) => item.id),
    [21]
  );
});
