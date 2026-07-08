const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assertExpectedSecondSigner,
  normalizeExpectedSecondSigner,
} = require('../src/dual-sign');

test('normalizeExpectedSecondSigner requires a target signer id', () => {
  assert.throws(() => normalizeExpectedSecondSigner(''), /请选择第二复签人/);
  assert.equal(normalizeExpectedSecondSigner(' 42 '), '42');
});

test('assertExpectedSecondSigner rejects signer mismatches', () => {
  assert.doesNotThrow(() => assertExpectedSecondSigner({ expectedSub: '42', actorSub: '42' }));
  assert.throws(
    () => assertExpectedSecondSigner({ expectedSub: '42', actorSub: '43', expectedName: 'alice' }),
    /该会签已指定由 alice 完成复签/
  );
});
