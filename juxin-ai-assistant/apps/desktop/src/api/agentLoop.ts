import { ApiError, apiFetch, getAuthPortalUrl } from './client';

export type AgentLoopMessage = {
  role: string;
  content: string;
};

export type LoopTraceStep = Record<string, unknown>;

export type LoopQualityCheckPayload = {
  mode: string;
  answer: string;
  usedKnowledge: boolean;
  retryCount: number;
  messages: AgentLoopMessage[];
};

export type LoopQualityCheckResult = {
  passed: boolean;
  issues: string[];
  retry_allowed: boolean;
  revision_messages: AgentLoopMessage[];
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (response.status === 401) {
    window.location.assign(getAuthPortalUrl());
    throw new ApiError(401, 'AUTH_REDIRECT', payload);
  }
  if (!response.ok) throw new ApiError(response.status, 'LOOP_QUALITY_CHECK_FAILED', payload);
  return payload as T;
}

export function shouldRunLoopQualityCheck(loopTrace?: LoopTraceStep[]): boolean {
  return Boolean(loopTrace?.some((step) =>
    step.state === 'QUALITY_CHECK' || step.action === 'revise_answer',
  ));
}

export async function checkLoopQuality(
  payload: LoopQualityCheckPayload,
): Promise<LoopQualityCheckResult> {
  return readJson(
    await apiFetch('/api/ai/agent-loop/quality-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: payload.mode,
        answer: payload.answer,
        used_knowledge: payload.usedKnowledge,
        retry_count: payload.retryCount,
        messages: payload.messages,
      }),
    }),
  );
}
