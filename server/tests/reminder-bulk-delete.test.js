const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCustomerBulkFilter,
  buildContactBulkFilter,
  buildLicenseBulkFilter,
  buildSendPlanBulkFilter,
} = require('../reminder-bulk-delete');

test('customer bulk filter keeps scope when deleting all', () => {
  const filter = buildCustomerBulkFilter({
    mode: 'all',
    filters: { search: 'ignored' },
    scope: { isAdmin: false, customerIds: [3, 5] },
  });

  assert.equal(filter.whereSql, 'WHERE customers.id IN (?, ?)');
  assert.deepEqual(filter.params, [3, 5]);
});

test('contact bulk filter applies customer, status, search and scope filters', () => {
  const filter = buildContactBulkFilter({
    mode: 'filtered',
    filters: { search: '张三', customer_id: '7', is_active: '1' },
    scope: { isAdmin: false, customerIds: [7, 8] },
  });

  assert.match(filter.whereSql, /cc.customer_id = \?/);
  assert.match(filter.whereSql, /contacts.is_active = \?/);
  assert.match(filter.whereSql, /contacts.name LIKE \?/);
  assert.match(filter.whereSql, /customers.id IN \(\?, \?\)/);
  assert.deepEqual(filter.params, ['7', '1', '%张三%', '%张三%', '%张三%', 7, 8]);
});

test('license bulk filter supports expiring and missing screenshot filters', () => {
  const filter = buildLicenseBulkFilter({
    mode: 'filtered',
    filters: { quick: 'expiring', days: '15', missing_screenshot: '1' },
    scope: { isAdmin: true, customerIds: [] },
  });

  assert.match(filter.whereSql, /licenses.end_date >= CURDATE\(\)/);
  assert.match(filter.whereSql, /DATE_ADD\(CURDATE\(\), INTERVAL \? DAY\)/);
  assert.match(filter.whereSql, /licenses.screenshot_url IS NULL/);
  assert.deepEqual(filter.params, [15]);
});

test('send plan bulk filter can target filtered disabled plans', () => {
  const filter = buildSendPlanBulkFilter({
    mode: 'filtered',
    filters: { search: '续费', enabled: '0' },
    scope: { isAdmin: false, customerIds: [12] },
  });

  assert.match(filter.whereSql, /send_plans.enabled = \?/);
  assert.match(filter.whereSql, /send_plans.name LIKE \?/);
  assert.match(filter.whereSql, /JSON_CONTAINS\(send_plans\.contact_ids, JSON_ARRAY\(contacts\.id\), '\$'\)/);
  assert.match(filter.whereSql, /contacts.name LIKE \?/);
  assert.match(filter.whereSql, /contacts.phone LIKE \?/);
  assert.match(filter.whereSql, /contacts.email LIKE \?/);
  assert.match(filter.whereSql, /contacts.wecom_id LIKE \?/);
  assert.match(filter.whereSql, /customers.id IN \(\?\)/);
  assert.deepEqual(filter.params, [
    '0',
    '%续费%',
    '%续费%',
    '%续费%',
    '%续费%',
    '%续费%',
    '%续费%',
    '%续费%',
    12,
  ]);
});
