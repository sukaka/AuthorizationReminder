import { invoke } from '@tauri-apps/api/core';

export type PendingResult = {
  generationUuid: string;
  completionToken: string;
  output: string;
  modelDisplayName: string;
  modelId: string;
  latencyMs: number;
  usage: Record<string, number>;
  retryCount: number;
  nextRetryAt: number;
};

type LocalQueueRecord = {
  id: string;
  payload: string;
  status: 'pending' | 'completed';
  created_at: number;
};

export async function loadPendingResults(userId: string): Promise<PendingResult[]> {
  const records = await invoke<LocalQueueRecord[]>('local_queue_list', { userId });
  return records.flatMap((record) => {
    if (record.status !== 'pending') return [];
    try {
      const parsed = JSON.parse(record.payload) as PendingResult;
      return parsed?.generationUuid === record.id ? [parsed] : [];
    } catch {
      return [];
    }
  });
}

export async function enqueuePendingResult(
  userId: string,
  item: PendingResult,
): Promise<void> {
  await invoke('local_queue_push', {
    userId,
    resultId: item.generationUuid,
    payload: JSON.stringify(item),
  });
}

export async function removePendingResult(
  userId: string,
  generationUuid: string,
): Promise<void> {
  await invoke('local_queue_remove', { userId, resultId: generationUuid });
}

export async function reschedulePendingResult(
  userId: string,
  item: PendingResult,
  now = Date.now(),
): Promise<void> {
  const retryCount = item.retryCount + 1;
  const delay = Math.min(60 * 60 * 1_000, 2 ** retryCount * 5_000);
  await enqueuePendingResult(userId, {
    ...item,
    retryCount,
    nextRetryAt: now + delay,
  });
}

export async function syncPendingResults(
  userId: string,
  now = Date.now(),
): Promise<void> {
  const current = await loadPendingResults(userId);
  for (const item of current) {
    if (item.nextRetryAt > now) continue;
    try {
      const response = await fetch(
        `/api/ai/generations/${encodeURIComponent(item.generationUuid)}/complete`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            completion_token: item.completionToken,
            output: item.output,
            model_display_name: item.modelDisplayName,
            model_id: item.modelId,
            latency_ms: item.latencyMs,
            usage: item.usage,
          }),
        },
      );
      if (!response.ok) throw new Error(`SYNC_${response.status}`);
      await removePendingResult(userId, item.generationUuid);
    } catch {
      await reschedulePendingResult(userId, item, now);
    }
  }
}

export async function logoutLocalUser(userId: string): Promise<void> {
  await invoke('local_logout', { userId });
}
