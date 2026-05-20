const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverSource = fs.readFileSync(path.join(process.cwd(), 'server', 'index.js'), 'utf8');
const dbSource = fs.readFileSync(path.join(process.cwd(), 'server', 'db.js'), 'utf8');

test('send plans can be auto-created without overwriting manual plans', () => {
  assert.match(dbSource, /auto_created TINYINT NOT NULL DEFAULT 0/);
  assert.match(dbSource, /auto_key VARCHAR\(255\)/);
  assert.match(serverSource, /DEFAULT_AUTO_REMINDER_DAYS = '90,60,30,7'/);
  assert.match(serverSource, /DEFAULT_AUTO_REMINDER_CHANNELS = \['wecom'\]/);
  assert.match(serverSource, /syncAutoSendPlansForCustomer/);
  assert.match(serverSource, /auto_created = 1/);
  assert.match(serverSource, /auto_key/);
});

test('customer contact and license writes trigger automatic send plan sync', () => {
  assert.match(serverSource, /syncAutoSendPlansForCustomer\(row\.id/);
  assert.match(serverSource, /syncAutoSendPlansForCustomers\(normalizedCustomerIds/);
  assert.match(serverSource, /syncAutoSendPlansForCustomer\(resolvedCustomerId/);
  assert.match(serverSource, /syncAutoSendPlansForAllCustomers/);
});
