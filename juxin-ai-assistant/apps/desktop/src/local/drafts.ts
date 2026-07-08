import { invoke } from '@tauri-apps/api/core';

type DraftRecord = {
  readonly task_id: string;
  readonly content: string;
  readonly saved_at: number;
};

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
  _now = Date.now(),
): Promise<void> {
  assertNoSecretKeys(values);
  await invoke('local_draft_save', {
    userId,
    taskId: taskUuid,
    content: JSON.stringify(values),
  });
}

export async function loadDraft(
  userId: string,
  taskUuid: string,
  _now = Date.now(),
): Promise<Record<string, unknown> | null> {
  const draft = await invoke<DraftRecord | null>('local_draft_load', {
    userId,
    taskId: taskUuid,
  });
  if (!draft) return null;
  try {
    const values = JSON.parse(draft.content) as unknown;
    return values && typeof values === 'object' && !Array.isArray(values)
      ? values as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export async function deleteDraft(userId: string, taskUuid: string): Promise<void> {
  await invoke('local_draft_delete', { userId, taskId: taskUuid });
}
