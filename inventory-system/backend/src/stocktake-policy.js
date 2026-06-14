const findDuplicateStocktakeTarget = (items = []) => {
  const firstIndexes = new Map();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] || {};
    const key = `${item.productId}:${item.storageLocationId}`;
    if (firstIndexes.has(key)) {
      return {
        productId: item.productId,
        storageLocationId: item.storageLocationId,
        firstIndex: firstIndexes.get(key),
        duplicateIndex: index,
      };
    }
    firstIndexes.set(key, index);
  }
  return null;
};

const getStocktakeTraceabilityConflict = ({ hasAdjustment, hasBatchBalance, hasInStockSerial } = {}) => {
  if (!hasAdjustment) return '';
  if (hasBatchBalance && hasInStockSerial) return 'batch-and-serial';
  if (hasBatchBalance) return 'batch';
  if (hasInStockSerial) return 'serial';
  return '';
};

module.exports = {
  findDuplicateStocktakeTarget,
  getStocktakeTraceabilityConflict,
};
