import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXAM_SESSION_STORAGE_KEY,
  readPersistedExamSessionId,
  persistExamSessionId,
  clearPersistedExamSessionId,
} from '../src/exam-session-storage.js';

const createStorage = () => {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
};

test('persistExamSessionId stores positive session ids and can read them back', () => {
  const storage = createStorage();

  persistExamSessionId(storage, 123);

  assert.equal(storage.getItem(EXAM_SESSION_STORAGE_KEY), '123');
  assert.equal(readPersistedExamSessionId(storage), 123);
});

test('readPersistedExamSessionId rejects invalid values and clears broken storage', () => {
  const storage = createStorage();
  storage.setItem(EXAM_SESSION_STORAGE_KEY, 'oops');

  assert.equal(readPersistedExamSessionId(storage), 0);
  assert.equal(storage.getItem(EXAM_SESSION_STORAGE_KEY), null);
});

test('persistExamSessionId clears storage for empty session ids', () => {
  const storage = createStorage();
  storage.setItem(EXAM_SESSION_STORAGE_KEY, '88');

  persistExamSessionId(storage, 0);

  assert.equal(storage.getItem(EXAM_SESSION_STORAGE_KEY), null);
});

test('clearPersistedExamSessionId removes existing exam session ids', () => {
  const storage = createStorage();
  storage.setItem(EXAM_SESSION_STORAGE_KEY, '77');

  clearPersistedExamSessionId(storage);

  assert.equal(storage.getItem(EXAM_SESSION_STORAGE_KEY), null);
});
