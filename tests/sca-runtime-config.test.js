const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');

const read = (relativePath) =>
  fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

test('SCA backend images prepare writable mounted data directories', () => {
  for (const file of ['sca-platform/backend/Dockerfile', 'sca-platform/backend/Dockerfile.scanner']) {
    const source = read(file);
    for (const dataDir of [
      '/data/sca/uploads',
      '/data/sca/reports',
      '/data/sca/sbom',
      '/data/sca/backups',
      '/data/scanner-results',
      '/data/trivy-cache',
    ]) {
      assert.match(source, new RegExp(dataDir.replaceAll('/', '\\/')), `${file} should prepare ${dataDir}`);
    }
    assert.match(source, /chown -R appuser:appuser \/data\/sca \/data\/scanner-results \/data\/trivy-cache/, `${file} should chown data directories`);
  }
});

test('SCA quick start includes scanner worker for queued upload scans', () => {
  const rootReadme = read('README.md');
  assert.match(
    rootReadme,
    /start auth sca-postgres sca-redis sca-api sca-worker sca-scanner-worker web-sca/,
    'root README SCA start command should include sca-scanner-worker'
  );

  const scaReadme = read('sca-platform/README.md');
  assert.match(
    scaReadme,
    /rebuild mysql auth sca-postgres sca-redis sca-api sca-worker sca-scanner-worker web-sca/,
    'SCA README rebuild command should include sca-scanner-worker'
  );
});
