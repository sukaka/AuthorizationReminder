import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

import type { ModelGenerateResult, ModelProfile } from '../types/tauri';

type GenerateInput = {
  profileId: string;
  messages: Array<{ role: string; content: string }>;
  temperature: number;
  requestId: string;
};

type DeltaPayload = {
  requestId: string;
  delta: string;
};

export async function generateLocalModel(
  input: GenerateInput,
  onDelta: (delta: string) => void,
): Promise<ModelGenerateResult> {
  const unlisten = await listen<DeltaPayload>(
    `model://delta/${input.requestId}`,
    (event) => {
      if (event.payload.requestId && event.payload.requestId !== input.requestId) return;
      if (event.payload.delta) onDelta(event.payload.delta);
    },
  );
  try {
    return await invoke<ModelGenerateResult>('model_generate', input);
  } finally {
    unlisten();
  }
}

export async function listModelProfiles(): Promise<ModelProfile[]> {
  return invoke<ModelProfile[]>('model_profile_list');
}

export async function cancelModelGeneration(requestId: string): Promise<void> {
  await invoke('model_cancel', { requestId });
}
