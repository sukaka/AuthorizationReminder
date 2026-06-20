import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { loadDraft, saveDraft } from '../src/local/drafts';
import {
  enqueuePendingResult,
  syncPendingResults,
  type PendingResult,
} from '../src/local/syncQueue';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

beforeEach(() => invokeMock.mockReset());
afterEach(() => vi.unstubAllGlobals());

it('stores task drafts under the signed-in user and expires them after seven days', async () => {
  invokeMock.mockResolvedValueOnce(undefined);
  await saveDraft('u-1', 'task-1', { background: '本周进展' }, 1_000);

  expect(invokeMock).toHaveBeenCalledWith('device_store_set', {
    key: 'draft:u-1:task-1',
    value: expect.any(String),
    encrypted: true,
  });
  const saved = JSON.parse(invokeMock.mock.calls[0][1].value);
  expect(saved).toEqual({
    values: { background: '本周进展' },
    expiresAt: 1_000 + 7 * 24 * 60 * 60 * 1_000,
  });
  expect(invokeMock.mock.calls[0][1].value).not.toMatch(/api.?key/i);

  invokeMock.mockReset();
  invokeMock.mockResolvedValueOnce(JSON.stringify(saved));
  expect(await loadDraft('u-1', 'task-1', 2_000)).toEqual({ background: '本周进展' });

  invokeMock.mockReset();
  invokeMock.mockResolvedValueOnce(JSON.stringify({ ...saved, expiresAt: 999 }));
  invokeMock.mockResolvedValueOnce(undefined);
  expect(await loadDraft('u-1', 'task-1', 2_000)).toBeNull();
  expect(invokeMock).toHaveBeenLastCalledWith('device_store_delete', {
    key: 'draft:u-1:task-1',
  });
});

it('queues a failed completion with retry metadata in encrypted device storage', async () => {
  const item: PendingResult = {
    generationUuid: 'gen-1',
    completionToken: 'token-1',
    output: '待同步结果',
    modelDisplayName: '公司模型',
    modelId: 'model-1',
    latencyMs: 42,
    usage: { output_tokens: 8 },
    retryCount: 0,
    nextRetryAt: 5_000,
  };
  invokeMock.mockResolvedValueOnce(null).mockResolvedValueOnce(undefined);

  await enqueuePendingResult(item);

  expect(invokeMock).toHaveBeenNthCalledWith(1, 'device_store_get', {
    key: 'pending-result-sync',
    encrypted: true,
  });
  expect(invokeMock).toHaveBeenNthCalledWith(2, 'device_store_set', {
    key: 'pending-result-sync',
    value: JSON.stringify([item]),
    encrypted: true,
  });
  expect(invokeMock.mock.calls[1][1].value).not.toMatch(/api.?key/i);
});

it('retries due pending results and removes a successfully synchronized item', async () => {
  const item: PendingResult = {
    generationUuid: 'gen-retry', completionToken: 'token-retry', output: '离线结果',
    modelDisplayName: '公司模型', modelId: 'model-1', latencyMs: 20, usage: {},
    retryCount: 1, nextRetryAt: 4_000,
  };
  invokeMock.mockResolvedValueOnce(JSON.stringify([item])).mockResolvedValueOnce(undefined);
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);

  await syncPendingResults(5_000);

  expect(fetchMock).toHaveBeenCalledWith('/api/ai/generations/gen-retry/complete', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      completion_token: 'token-retry', output: '离线结果',
      model_display_name: '公司模型', model_id: 'model-1', latency_ms: 20, usage: {},
    }),
  });
  expect(invokeMock).toHaveBeenLastCalledWith('device_store_delete', {
    key: 'pending-result-sync',
  });
});
