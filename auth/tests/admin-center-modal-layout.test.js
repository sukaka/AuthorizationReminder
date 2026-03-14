const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

test('admin center edit modal is centered in viewport', () => {
  assert.match(
    source,
    /\.modal-shell\{[^}]*display:grid;[^}]*place-items:center;[^}]*padding:24px;[^}]*overflow:auto[^}]*\}/
  );
  assert.match(source, /\.modal-panel\{[^}]*width:min\(1180px,100%\)/);
  assert.match(source, /\.modal-panel\{[^}]*max-height:calc\(100vh - 48px\)/);
  assert.match(source, /\.modal-panel\{[^}]*margin:0/);
});
