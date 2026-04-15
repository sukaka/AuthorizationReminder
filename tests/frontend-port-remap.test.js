const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');

const read = (relativePath) =>
  fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

const expectContains = (source, pattern, context) => {
  assert.match(source, pattern, `${context} should include ${pattern}`);
};

const expectNotContains = (source, pattern, context) => {
  assert.doesNotMatch(source, pattern, `${context} should not include ${pattern}`);
};

test('docker compose exposes reminder through train-exam on 18080-18087', () => {
  const source = read('docker-compose.yml');

  for (const port of ['18080', '18081', '18082', '18083', '18084', '18085', '18086', '18087']) {
    expectContains(source, new RegExp(`"${port}:80"`), 'docker-compose.yml');
  }

  for (const port of ['8080', '8081', '8082', '8083', '8084', '8085', '8086', '8087']) {
    expectNotContains(source, new RegExp(`"${port}:80"`), 'docker-compose.yml');
  }
});

test('frontend dev entrypoints use the 1808x access ports', () => {
  const expectations = [
    ['web/vite.config.js', /port:\s*18080/],
    ['ticketing/web/vite.config.js', /port:\s*18081/],
    ['inventory-system/frontend/package\.json', /vite --host 0\.0\.0\.0 --port 18082/],
    ['device-flow/frontend/package\.json', /vite --host 0\.0\.0\.0 --port 18083/],
    ['delivery/frontend/package\.json', /vite --host 0\.0\.0\.0 --port 18084/],
    ['faq/frontend/package\.json', /vite --host 0\.0\.0\.0 --port 18085/],
    ['tender/frontend/package\.json', /vite --host 0\.0\.0\.0 --port 18086/],
    ['train-exam/frontend/package\.json', /vite --host 0\.0\.0\.0 --port 18087/],
  ];

  expectations.forEach(([relativePath, pattern]) => {
    expectContains(read(relativePath), pattern, relativePath);
  });
});

test('runtime defaults and helper scripts no longer advertise 8080-8087', () => {
  const files = [
    'auth/index.js',
    'server/index.js',
    'ticketing/index.js',
    'inventory-system/backend/src/index.js',
    'inventory-system/shipping-gateway/src/index.js',
    'device-flow/backend/src/index.js',
    'delivery/backend/src/index.js',
    'faq/backend/src/index.js',
    'tender/backend/src/index.js',
    'train-exam/backend/src/index.js',
    'scripts/tests/reminder.sh',
    'scripts/tests/ticketing.sh',
    'scripts/tests/inventory.sh',
    'scripts/tests/device-flow.sh',
    'scripts/tests/faq.sh',
    'scripts/tests/tender.sh',
    'scripts/tests/train-exam.sh',
    'scripts/tests/public-host-cors-config.sh',
  ];

  files.forEach((relativePath) => {
    const source = read(relativePath);
    expectNotContains(source, /localhost:808[0-7]/, relativePath);
    expectNotContains(source, /127\.0\.0\.1:808[0-7]/, relativePath);
  });
});
