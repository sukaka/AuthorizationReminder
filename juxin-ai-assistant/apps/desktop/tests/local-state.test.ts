import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { loadDraft, saveDraft } from '../src/local/drafts';
import {
  deleteLegacyUnassigned,
  enqueuePendingResult,
  exportLegacyUnassigned,
  logoutLocalUser,
  syncPendingResults,
  type PendingResult,
} from '../src/local/syncQueue';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

beforeEach(() => invokeMock.mockReset());
afterEach(() => vi.unstubAllGlobals());

it('stores and loads task drafts through the user-isolated Rust queue', async () => {
  invokeMock.mockResolvedValueOnce(undefined);
  await saveDraft('u-1', 'task-1', { background: '本周进展' }, 1_000);

  expect(invokeMock).toHaveBeenCalledWith('local_draft_save', {
    userId: 'u-1',
    taskId: 'task-1',
    content: JSON.stringify({ background: '本周进展' }),
  });
  expect(invokeMock.mock.calls[0][1].content).not.toMatch(/api.?key/i);

  invokeMock.mockReset();
  invokeMock.mockResolvedValueOnce({
    task_id: 'task-1', content: JSON.stringify({ background: '本周进展' }), saved_at: 1,
  });
  expect(await loadDraft('u-1', 'task-1', 2_000)).toEqual({ background: '本周进展' });
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

  await enqueuePendingResult('u-1', item);

  expect(invokeMock).toHaveBeenCalledWith('local_queue_push', {
    userId: 'u-1',
    resultId: 'gen-1',
    payload: JSON.stringify(item),
  });
  expect(invokeMock.mock.calls[0][1].payload).not.toMatch(/api.?key/i);
});

it('retries due pending results and removes a successfully synchronized item', async () => {
  const item: PendingResult = {
    generationUuid: 'gen-retry', completionToken: 'token-retry', output: '离线结果',
    modelDisplayName: '公司模型', modelId: 'model-1', latencyMs: 20, usage: {},
    retryCount: 1, nextRetryAt: 4_000,
  };
  invokeMock.mockResolvedValueOnce([{
    id: item.generationUuid, payload: JSON.stringify(item), status: 'pending', created_at: 1,
  }]).mockResolvedValueOnce(undefined);
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);

  const result = await syncPendingResults('u-1', 5_000);

  expect(fetchMock).toHaveBeenCalledWith('/api/ai/generations/gen-retry/complete', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      completion_token: 'token-retry', output: '离线结果',
      model_display_name: '公司模型', model_id: 'model-1', latency_ms: 20, usage: {},
    }),
  });
  expect(invokeMock).toHaveBeenLastCalledWith('local_queue_remove', {
    userId: 'u-1',
    resultId: 'gen-retry',
  });
  expect(result).toEqual({ attempted: 1, synced: 1, failed: 0, pending: 0 });
});

it('can force retry pending results before their backoff expires', async () => {
  const item: PendingResult = {
    generationUuid: 'gen-delayed', completionToken: 'token-delayed', output: '延迟结果',
    modelDisplayName: '公司模型', modelId: 'model-1', latencyMs: 20, usage: {},
    retryCount: 4, nextRetryAt: 60_000,
  };
  invokeMock.mockResolvedValueOnce([{
    id: item.generationUuid, payload: JSON.stringify(item), status: 'pending', created_at: 1,
  }]).mockResolvedValueOnce(undefined);
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);

  await syncPendingResults('u-1', 5_000, { force: true });

  expect(fetchMock).toHaveBeenCalledOnce();
  expect(invokeMock).toHaveBeenLastCalledWith('local_queue_remove', {
    userId: 'u-1',
    resultId: 'gen-delayed',
  });
});

it('reports failed synchronization and keeps the result pending', async () => {
  const item: PendingResult = {
    generationUuid: 'gen-failed-sync', completionToken: 'token-failed', output: '待重试',
    modelDisplayName: '公司模型', modelId: 'model-1', latencyMs: 20, usage: {},
    retryCount: 0, nextRetryAt: 1_000,
  };
  invokeMock.mockResolvedValueOnce([{
    id: item.generationUuid, payload: JSON.stringify(item), status: 'pending', created_at: 1,
  }]).mockResolvedValueOnce(undefined);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

  const result = await syncPendingResults('u-1', 5_000, { force: true });

  expect(result).toEqual({ attempted: 1, synced: 0, failed: 1, pending: 1 });
  expect(invokeMock).toHaveBeenLastCalledWith(
    'local_queue_push',
    expect.objectContaining({ userId: 'u-1', resultId: 'gen-failed-sync' }),
  );
  expect(invokeMock).not.toHaveBeenCalledWith(
    'local_queue_remove',
    expect.anything(),
  );
});

it('logs out only the current local user without deleting unsynced results', async () => {
  invokeMock.mockResolvedValueOnce({ drafts_deleted: 2, completed_deleted: 0, pending_deleted: 0 });
  await logoutLocalUser('u-1');
  expect(invokeMock).toHaveBeenCalledWith('local_logout', { userId: 'u-1' });
});

it('exports or deletes legacy-unassigned data without adding an origin argument', async () => {
  invokeMock.mockResolvedValueOnce({
    drafts: [],
    pending_results: [],
  });
  expect(await exportLegacyUnassigned('u-1')).toEqual({
    drafts: [],
    pending_results: [],
  });
  expect(invokeMock).toHaveBeenLastCalledWith('local_legacy_export', {
    userId: 'u-1',
  });

  invokeMock.mockResolvedValueOnce(undefined);
  await deleteLegacyUnassigned('u-1');
  expect(invokeMock).toHaveBeenLastCalledWith('local_legacy_delete', {
    userId: 'u-1',
  });
});
