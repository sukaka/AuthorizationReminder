const test = require('node:test');
const assert = require('node:assert/strict');

const {
  findDuplicateStocktakeTarget,
  getStocktakeTraceabilityConflict,
} = require('../src/stocktake-policy');

test('detects duplicate product and storage location targets', () => {
  const duplicate = findDuplicateStocktakeTarget([
    { productId: 10, storageLocationId: 20 },
    { productId: 11, storageLocationId: 20 },
    { productId: 10, storageLocationId: 20 },
  ]);

  assert.deepEqual(duplicate, {
    productId: 10,
    storageLocationId: 20,
    firstIndex: 0,
    duplicateIndex: 2,
  });
});

test('accepts unique stocktake targets', () => {
  assert.equal(
    findDuplicateStocktakeTarget([
      { productId: 10, storageLocationId: 20 },
      { productId: 10, storageLocationId: 21 },
    ]),
    null
  );
});

test('rejects aggregate stocktake when batch or serial balances exist', () => {
  assert.equal(
    getStocktakeTraceabilityConflict({
      hasAdjustment: true,
      hasBatchBalance: true,
      hasInStockSerial: false,
    }),
    'batch'
  );
  assert.equal(
    getStocktakeTraceabilityConflict({
      hasAdjustment: true,
      hasBatchBalance: false,
      hasInStockSerial: true,
    }),
    'serial'
  );
  assert.equal(
    getStocktakeTraceabilityConflict({
      hasAdjustment: true,
      hasBatchBalance: true,
      hasInStockSerial: true,
    }),
    'batch-and-serial'
  );
  assert.equal(
    getStocktakeTraceabilityConflict({
      hasAdjustment: true,
      hasBatchBalance: false,
      hasInStockSerial: false,
    }),
    ''
  );
});

test('allows a no-difference stocktake for traced inventory', () => {
  assert.equal(
    getStocktakeTraceabilityConflict({
      hasAdjustment: false,
      hasBatchBalance: true,
      hasInStockSerial: true,
    }),
    ''
  );
});
