import { invoke } from '@tauri-apps/api/core';

const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

type DraftEnvelope = {
  values: Record<string, unknown>;
  expiresAt: number;
};

function draftKey(userId: string, taskUuid: string) {
  return `draft:${userId}:${taskUuid}`;
}

function assertNoSecretKeys(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (/^(api_?key|authorization|token)$/i.test(key)) {
      throw new Error('DRAFT_SECRET_FIELD_FORBIDDEN');
    }
    assertNoSecretKeys(nested);
  }
}

export async function saveDraft(
  userId: string,
  taskUuid: string,
  values: Record<string, unknown>,
  now = Date.now(),
): Promise<void> {
  assertNoSecretKeys(values);
  const envelope: DraftEnvelope = {
    values,
    expiresAt: now + DRAFT_TTL_MS,
  };
  await invoke('device_store_set', {
    key: draftKey(userId, taskUuid),
    value: JSON.stringify(envelope),
    encrypted: true,
  });
}

export async function loadDraft(
  userId: string,
  taskUuid: string,
  now = Date.now(),
): Promise<Record<string, unknown> | null> {
  const key = draftKey(userId, taskUuid);
  const raw = await invoke<string | null>('device_store_get', {
    key,
    encrypted: true,
  });
  if (!raw) return null;
  let envelope: DraftEnvelope;
  try {
    envelope = JSON.parse(raw) as DraftEnvelope;
  } catch {
    await invoke('device_store_delete', { key });
    return null;
  }
  if (!envelope.expiresAt || envelope.expiresAt <= now) {
    await invoke('device_store_delete', { key });
    return null;
  }
  return envelope.values;
}

export async function deleteDraft(userId: string, taskUuid: string): Promise<void> {
  await invoke('device_store_delete', { key: draftKey(userId, taskUuid) });
}
