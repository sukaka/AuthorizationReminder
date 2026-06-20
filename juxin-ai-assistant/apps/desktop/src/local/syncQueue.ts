import { invoke } from '@tauri-apps/api/core';

const QUEUE_KEY = 'pending-result-sync';

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

export async function loadPendingResults(): Promise<PendingResult[]> {
  const raw = await invoke<string | null>('device_store_get', {
    key: QUEUE_KEY,
    encrypted: true,
  });
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as PendingResult[] : [];
  } catch {
    return [];
  }
}

async function savePendingResults(items: PendingResult[]): Promise<void> {
  if (items.length === 0) {
    await invoke('device_store_delete', { key: QUEUE_KEY });
    return;
  }
  await invoke('device_store_set', {
    key: QUEUE_KEY,
    value: JSON.stringify(items),
    encrypted: true,
  });
}

export async function enqueuePendingResult(item: PendingResult): Promise<void> {
  const current = await loadPendingResults();
  const withoutDuplicate = current.filter(
    (candidate) => candidate.generationUuid !== item.generationUuid,
  );
  await savePendingResults([...withoutDuplicate, item]);
}

export async function removePendingResult(generationUuid: string): Promise<void> {
  const current = await loadPendingResults();
  await savePendingResults(
    current.filter((item) => item.generationUuid !== generationUuid),
  );
}

export async function reschedulePendingResult(
  item: PendingResult,
  now = Date.now(),
): Promise<void> {
  const retryCount = item.retryCount + 1;
  const delay = Math.min(60 * 60 * 1_000, 2 ** retryCount * 5_000);
  await enqueuePendingResult({
    ...item,
    retryCount,
    nextRetryAt: now + delay,
  });
}

export async function syncPendingResults(now = Date.now()): Promise<void> {
  const current = await loadPendingResults();
  const remaining: PendingResult[] = [];
  for (const item of current) {
    if (item.nextRetryAt > now) {
      remaining.push(item);
      continue;
    }
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
    } catch {
      const retryCount = item.retryCount + 1;
      remaining.push({
        ...item,
        retryCount,
        nextRetryAt: now + Math.min(60 * 60 * 1_000, 2 ** retryCount * 5_000),
      });
    }
  }
  await savePendingResults(remaining);
}
