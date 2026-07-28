import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { setupServer } from 'msw/node';

export const server = setupServer(
  http.get('/api/ai/model-profiles', () => HttpResponse.json([])),
  http.get('/api/ai/role-assistants', () => HttpResponse.json({
    items: [],
    templates: [],
    catalog_assistants: 0,
  })),
  http.get('/api/ai/long-tasks', () => HttpResponse.json({
    items: [],
    total: 0,
    page: 1,
    page_size: 50,
  })),
  http.get('/api/ai/long-tasks/notifications', () => HttpResponse.json({
    items: [],
    total: 0,
    unread_count: 0,
  })),
  http.get('/api/ai/learning-candidates', () => HttpResponse.json({
    items: [],
    total: 0,
  })),
  http.get('/api/ai/admin/task-replays', () => HttpResponse.json({
    items: [],
    total: 0,
  })),
  http.post('/api/ai/audit/local-model-events', () => new HttpResponse(null, { status: 204 })),
  http.get('/api/ai/projects', () => HttpResponse.json([])),
  http.get('/api/conversations', () => HttpResponse.json({
    items: [],
    total: 0,
    page: 1,
    page_size: 20,
  })),
  http.get('/api/knowledge/categories', () => HttpResponse.json({
    items: [],
    total: 0,
  })),
  http.get('/api/knowledge/document-types', () => HttpResponse.json({
    items: [],
    total: 0,
  })),
);

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
}

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: new MemoryStorage(),
});

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  localStorage.clear();
  window.history.replaceState({}, '', '/');
  document.documentElement.removeAttribute('data-theme');
});
afterAll(() => server.close());
