import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useState } from 'react';

import {
  SensitiveWarningDialog,
  type SensitiveFinding,
} from '../components/SensitiveWarningDialog';
import {
  DynamicTaskForm,
  type DynamicFieldDefinition,
} from '../components/DynamicTaskForm';
import { FeedbackPanel } from '../components/FeedbackPanel';
import { OutputReader } from '../components/OutputReader';
import { deleteDraft, loadDraft, saveDraft } from '../local/drafts';
import { generateLocalModel } from '../local/modelStream';
import { enqueuePendingResult } from '../local/syncQueue';
import type { ModelProfile } from '../types/tauri';
import {
  downloadGenerationWord,
  reportLocalModelAuditEvent,
  reportGenerationFailure,
  type LocalModelAuditEvent,
  type TaskPayload,
} from '../api/client';

export type TaskDefinition = Omit<TaskPayload, 'fields'> & {
  fields: DynamicFieldDefinition[];
};

type PreparedGeneration = {
  generation_uuid: string;
  completion_token: string;
  messages: Array<{ role: string; content: string }>;
  temperature: number;
  safety_notice: string;
  context_usage?: {
    characters: number;
    estimated_tokens: number;
    estimator: string;
  };
};

type SensitiveConfirmation = {
  digest: string;
  findings: SensitiveFinding[];
};

function hasMeaningfulSensitiveValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasMeaningfulSensitiveValue);
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(hasMeaningfulSensitiveValue);
  }
  return true;
}

function getSensitiveFieldLabel(
  fieldKey: string,
  fields: DynamicFieldDefinition[],
): string {
  const label = fields.find((field) => field.field_key === fieldKey)?.label.trim();
  if (label) return label;
  if (/^(?:blank|manual|reviewed|choice|bracket)_slot_\d+$/i.test(fieldKey)) return '输入内容';
  return fieldKey || '输入内容';
}

function presentSensitiveFindings(
  findings: SensitiveFinding[],
  fields: DynamicFieldDefinition[],
  values: Record<string, unknown>,
): SensitiveFinding[] {
  return findings
    .filter((finding) => hasMeaningfulSensitiveValue(values[finding.field]))
    .map((finding) => ({
      ...finding,
      field: getSensitiveFieldLabel(finding.field, fields),
    }));
}

function getGenerationErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : '生成失败，请检查本地模型配置后重试';
}

function getGenerationErrorCode(error: unknown): string {
  const message = getGenerationErrorMessage(error);
  const match = message.match(/^[A-Z][A-Z0-9_]+/);
  return match?.[0] || 'LOCAL_MODEL_FAILED';
}

function getPositiveUsageNumber(usage: Record<string, unknown>, key: string): number {
  const value = usage[key];
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function formatCompletedTokenUsage(output: string, usage: Record<string, unknown>): string {
  const totalTokens = getPositiveUsageNumber(usage, 'total_tokens');
  if (totalTokens > 0) return `本次生成约 ${Math.round(totalTokens)} tokens`;

  const inputTokens =
    getPositiveUsageNumber(usage, 'input_tokens')
    || getPositiveUsageNumber(usage, 'prompt_tokens');
  const outputTokens =
    getPositiveUsageNumber(usage, 'output_tokens')
    || getPositiveUsageNumber(usage, 'completion_tokens');
  const knownTokens = inputTokens + outputTokens;
  if (knownTokens > 0) return `本次生成约 ${Math.round(knownTokens)} tokens`;

  if (!output.trim()) return '';
  return `本次输出约 ${Math.max(1, Math.ceil(output.length / 4))} tokens`;
}

export function TaskRunPage({ task, userId }: { task: TaskDefinition; userId?: string }) {
  const desktopAvailable = Boolean(window.__TAURI_INTERNALS__);
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [profileId, setProfileId] = useState('');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [output, setOutput] = useState('');
  const [status, setStatus] = useState<'idle' | 'preparing' | 'generating' | 'saving' | 'done'>('idle');
  const [error, setError] = useState('');
  const [requestId, setRequestId] = useState('');
  const [sensitiveConfirmation, setSensitiveConfirmation] = useState<SensitiveConfirmation | null>(null);
  const [draftReady, setDraftReady] = useState(!userId);
  const [syncMessage, setSyncMessage] = useState('');
  const [exportMessage, setExportMessage] = useState('');
  const [generationUuid, setGenerationUuid] = useState('');
  const [activeGenerationUuid, setActiveGenerationUuid] = useState('');
  const [contextUsageText, setContextUsageText] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!desktopAvailable) return;
    invoke<ModelProfile[]>('model_profile_list')
      .then((items) => {
        setProfiles(items);
        setProfileId(items.find((profile) => profile.isDefault)?.id || items[0]?.id || '');
      })
      .catch(() => setError('无法读取当前设备的模型配置'));
  }, [desktopAvailable]);

  useEffect(() => {
    if (!desktopAvailable || !userId) return;
    let active = true;
    setDraftReady(false);
    loadDraft(userId, task.uuid)
      .then((draft) => {
        if (active && draft) setValues(draft);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setDraftReady(true);
      });
    return () => {
      active = false;
    };
  }, [desktopAvailable, task.uuid, userId]);

  useEffect(() => {
    if (!desktopAvailable || !userId || !draftReady) return;
    const timer = window.setTimeout(() => {
      saveDraft(userId, task.uuid, values).catch(() => undefined);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [desktopAvailable, draftReady, task.uuid, userId, values]);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === profileId),
    [profileId, profiles],
  );

  const setValue = (fieldKey: string, value: unknown) => {
    setValues((current) => ({ ...current, [fieldKey]: value }));
  };

  const runPrepared = async (prepared: PreparedGeneration) => {
    if (!selectedProfile) throw new Error('请先配置一个本地模型');
    setStatus('generating');
    setOutput('');
    setContextUsageText('');
    setActiveGenerationUuid(prepared.generation_uuid);
    const currentRequestId = crypto.randomUUID();
    setRequestId(currentRequestId);
    const auditLocalModel = (
      event: LocalModelAuditEvent,
      options: { latencyMs?: number; errorCode?: string } = {},
    ) => reportLocalModelAuditEvent({
      generationUuid: prepared.generation_uuid,
      event,
      modelId: selectedProfile.modelId,
      provider: 'local-desktop',
      ...options,
    }).catch(() => undefined);

    void auditLocalModel('MODEL_STARTED');
    const generated = await generateLocalModel({
      profileId: selectedProfile.id,
      messages: prepared.messages,
      temperature: prepared.temperature,
      requestId: currentRequestId,
    }, (delta) => setOutput((current) => current + delta)).catch((modelError) => {
      void auditLocalModel('MODEL_FAILED', {
        errorCode: getGenerationErrorCode(modelError),
      });
      throw modelError;
    });
    void auditLocalModel('MODEL_COMPLETED', { latencyMs: generated.latencyMs });
    setOutput(generated.output);
    setContextUsageText(formatCompletedTokenUsage(generated.output, generated.usage));

    setStatus('saving');
    const completeResponse = await fetch(
      `/api/ai/generations/${prepared.generation_uuid}/complete`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          completion_token: prepared.completion_token,
          output: generated.output,
          model_display_name: selectedProfile.displayName,
          model_id: selectedProfile.modelId,
          latency_ms: generated.latencyMs,
          usage: generated.usage,
        }),
      },
    );
    if (!completeResponse.ok) {
      if (userId) {
        await enqueuePendingResult(userId, {
          generationUuid: prepared.generation_uuid,
          completionToken: prepared.completion_token,
          output: generated.output,
          modelDisplayName: selectedProfile.displayName,
          modelId: selectedProfile.modelId,
          latencyMs: generated.latencyMs,
          usage: generated.usage,
          retryCount: 0,
          nextRetryAt: Date.now() + 5_000,
        });
        void auditLocalModel('MODEL_SYNC_PENDING', {
          latencyMs: generated.latencyMs,
          errorCode: `COMPLETE_${completeResponse.status}`,
        });
        setSyncMessage('结果已保存在本机，恢复连接后自动同步');
      } else {
        setSyncMessage('结果尚未同步，请保持当前页面并稍后重试');
      }
    } else {
      setSyncMessage('结果已同步');
    }
    setGenerationUuid(prepared.generation_uuid);
    setStatus('done');
    setRequestId('');
    setActiveGenerationUuid('');
    setSensitiveConfirmation(null);
    if (userId) await deleteDraft(userId, task.uuid).catch(() => undefined);
  };

  const generate = async (confirmationDigest?: string) => {
    setError('');
    for (const field of task.fields) {
      if (field.required && !values[field.field_key]) {
        setError(`请填写${field.label}`);
        return;
      }
    }
    if (!selectedProfile) {
      setError('请先配置一个本地模型');
      return;
    }

    try {
      setSyncMessage('');
      setStatus('preparing');
      const prepareResponse = await fetch('/api/ai/generations/prepare', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_uuid: task.uuid,
          inputs: values,
          ...(confirmationDigest
            ? { sensitive_confirmation_digest: confirmationDigest }
            : {}),
        }),
      });
      if (!prepareResponse.ok) {
        const payload = await prepareResponse.json().catch(() => null) as {
          detail?: {
            code?: string;
            confirmation_digest?: string;
            findings?: SensitiveFinding[];
          };
        } | null;
        if (
          prepareResponse.status === 409
          && payload?.detail?.code === 'SENSITIVE_CONFIRMATION_REQUIRED'
          && payload.detail.confirmation_digest
        ) {
          const findings = presentSensitiveFindings(
            payload.detail.findings || [],
            task.fields,
            values,
          );
          if (!findings.length) {
            await generate(payload.detail.confirmation_digest);
            return;
          }
          setSensitiveConfirmation({
            digest: payload.detail.confirmation_digest,
            findings,
          });
          setStatus('idle');
          return;
        }
        throw new Error(`PREPARE_${prepareResponse.status}`);
      }
      const prepared = (await prepareResponse.json()) as PreparedGeneration;
      try {
        await runPrepared(prepared);
      } catch (generationError) {
        await reportGenerationFailure(prepared.generation_uuid, {
          completionToken: prepared.completion_token,
          errorCode: getGenerationErrorCode(generationError),
          errorMessage: getGenerationErrorMessage(generationError),
        }).catch(() => undefined);
        throw generationError;
      }
    } catch (generationError) {
      setStatus('idle');
      setRequestId('');
      setActiveGenerationUuid('');
      setError(getGenerationErrorMessage(generationError));
    }
  };

  const regenerate = async () => {
    if (!generationUuid || !selectedProfile) return;
    setError('');
    setSyncMessage('');
    try {
      setStatus('preparing');
      const response = await fetch(
        `/api/ai/generations/${encodeURIComponent(generationUuid)}/regenerate`,
        { method: 'POST', credentials: 'include' },
      );
      if (!response.ok) throw new Error(`REGENERATE_${response.status}`);
      await runPrepared(await response.json() as PreparedGeneration);
    } catch (regenerationError) {
      setStatus('done');
      setRequestId('');
      setActiveGenerationUuid('');
      setError(
        regenerationError instanceof Error
          ? regenerationError.message
          : '重新生成失败，请稍后重试',
      );
    }
  };

  const copyOutput = async () => {
    if (output) await navigator.clipboard?.writeText(output);
  };

  const exportWord = async () => {
    if (!generationUuid) return;
    setError('');
    setExportMessage('');
    setExporting(true);
    try {
      const result = await downloadGenerationWord(generationUuid);
      setExportMessage(
        result.kind === 'desktop'
          ? `Word 已保存到：${result.path}`
          : 'Word 下载已开始',
      );
    } catch {
      setError('Word 导出失败，请稍后重试');
    } finally {
      setExporting(false);
    }
  };

  const stop = async () => {
    if (!requestId) return;
    if (activeGenerationUuid && selectedProfile) {
      reportLocalModelAuditEvent({
        generationUuid: activeGenerationUuid,
        event: 'MODEL_CANCELLED',
        modelId: selectedProfile.modelId,
        provider: 'local-desktop',
      }).catch(() => undefined);
    }
    await invoke('model_cancel', { requestId });
  };

  if (!desktopAvailable) {
    return (
      <section className="desktop-required">
        <span>⌁</span>
        <h2>请在桌面客户端中生成</h2>
        <p>生成能力仅在聚信 AI 助手桌面客户端中可用</p>
      </section>
    );
  }

  return (
    <section className="task-run-layout">
      <header className="task-summary">
        <div>
          <span className="eyebrow">当前任务</span>
          <h2>{task.name}</h2>
          <p>{task.description}</p>
        </div>
        <div className="safety-note">{task.safety_notice}</div>
      </header>

      <div className="task-workspace">
        <form className="task-form" onSubmit={(event) => event.preventDefault()}>
          <div className="task-panel-heading">
            <div>
              <span className="eyebrow">填写信息</span>
              <h3>告诉聚信这次要处理的内容</h3>
            </div>
            <select
              aria-label="本地模型"
              onChange={(event) => setProfileId(event.target.value)}
              value={profileId}
            >
              <option value="">选择模型</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.displayName}</option>
              ))}
            </select>
          </div>

          <DynamicTaskForm fields={task.fields} onChange={setValue} values={values} />

          {error && <p className="form-error" role="alert">{error}</p>}
          <button
            className="primary-action"
            disabled={status !== 'idle' && status !== 'done'}
            onClick={() => generate()}
            type="button"
          >
            {status === 'preparing'
              ? '正在准备…'
              : status === 'generating'
                ? '正在生成…'
                : status === 'saving'
                  ? '正在保存…'
                  : '开始生成'}
          </button>
          {status === 'generating' && (
            <button className="secondary-action" onClick={stop} type="button">停止生成</button>
          )}
        </form>

        <article className="result-panel">
          <span className="eyebrow">输出预览</span>
          {contextUsageText ? <p className="context-usage">{contextUsageText}</p> : null}
          <OutputReader emptyText="完成左侧信息后，结果会在这里流式呈现。" text={output} />
          {syncMessage ? <p className="sync-status" role="status">{syncMessage}</p> : null}
          {exportMessage ? <p className="sync-status" role="status">{exportMessage}</p> : null}
          {output ? (
            <div className="result-actions">
              <button className="secondary-action" onClick={copyOutput} type="button">复制全文</button>
              <button className="secondary-action" disabled={status !== 'done'} onClick={regenerate} type="button">重新生成</button>
              <button
                className="secondary-action"
                disabled={status !== 'done' || exporting || syncMessage !== '结果已同步'}
                onClick={() => void exportWord()}
                type="button"
              >
                {exporting ? '正在导出…' : '导出 Word'}
              </button>
            </div>
          ) : null}
          {generationUuid && status === 'done' ? (
            <FeedbackPanel generationUuid={generationUuid} />
          ) : null}
        </article>
      </div>
      {sensitiveConfirmation ? (
        <SensitiveWarningDialog
          findings={sensitiveConfirmation.findings}
          onCancel={() => setSensitiveConfirmation(null)}
          onConfirm={() => generate(sensitiveConfirmation.digest)}
        />
      ) : null}
    </section>
  );
}
