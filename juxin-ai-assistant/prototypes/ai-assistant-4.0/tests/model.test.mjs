import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addBlock,
  createInitialState,
  createVersion,
  moveBlock,
  reorderBlocks,
  removeBlock,
} from '../model.mjs';

test('initial document uses stable unique ids for paragraph, table and image blocks', () => {
  const state = createInitialState();
  const ids = state.blocks.map((block) => block.id);

  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(state.blocks.map((block) => block.type), [
    'paragraph',
    'table',
    'image',
    'paragraph',
  ]);
  assert.equal(state.version, 3);
});

test('drag-style reordering keeps block identity and supports keyboard movement', () => {
  const original = createInitialState().blocks;
  const reordered = reorderBlocks(original, 'risk-register', 'executive-summary');
  const moved = moveBlock(reordered, 'architecture-map', 1);

  assert.deepEqual(reordered.map((block) => block.id), [
    'risk-register',
    'executive-summary',
    'architecture-map',
    'delivery-plan',
  ]);
  assert.deepEqual(moved.map((block) => block.id), [
    'risk-register',
    'executive-summary',
    'delivery-plan',
    'architecture-map',
  ]);
  assert.strictEqual(
    reordered.find((block) => block.id === 'risk-register'),
    original.find((block) => block.id === 'risk-register'),
  );
});

test('adding and removing content blocks never leave an empty document', () => {
  const original = createInitialState().blocks;
  const added = addBlock(original, 'paragraph', 5);
  const reduced = removeBlock(added, 'paragraph-5');

  assert.equal(added.at(-1).id, 'paragraph-5');
  assert.equal(added.at(-1).type, 'paragraph');
  assert.deepEqual(reduced, original);
  assert.throws(
    () => removeBlock([original[0]], original[0].id),
    /至少保留一个内容块/,
  );
});

test('creating a version returns an immutable snapshot with the next version number', () => {
  const state = createInitialState();
  const snapshot = createVersion(state.blocks, state.version, '张磊');

  assert.equal(snapshot.version, 4);
  assert.equal(snapshot.author, '张磊');
  assert.notStrictEqual(snapshot.blocks, state.blocks);
  assert.deepEqual(snapshot.blocks, state.blocks);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.blocks));
});
