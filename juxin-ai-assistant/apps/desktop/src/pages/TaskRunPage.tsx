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
import { deleteDraft, loadDraft, saveDraft } from '../local/drafts';
import { generateLocalModel } from '../local/modelStream';
import { enqueuePendingResult } from '../local/syncQueue';
import type { ModelProfile } from '../types/tauri';
import { downloadGenerationWord, type TaskPayload } from '../api/client';

export type TaskDefinition = Omit<TaskPayload, 'fields'> & {
  fields: DynamicFieldDefinition[];
};

type PreparedGeneration = {
  generation_uuid: string;
  completion_token: string;
  messages: Array<{ role: string; content: string }>;
  temperature: number;
  safety_notice: string;
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
  const [generationUuid, setGenerationUuid] = useState('');
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
    const currentRequestId = crypto.randomUUID();
    setRequestId(currentRequestId);
    const generated = await generateLocalModel({
      profileId: selectedProfile.id,
      messages: prepared.messages,
      temperature: prepared.temperature,
      requestId: currentRequestId,
    }, (delta) => setOutput((current) => current + delta));
    setOutput(generated.output);

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
      await runPrepared(prepared);
    } catch (generationError) {
      setStatus('idle');
      setRequestId('');
      setError(
        generationError instanceof Error
          ? generationError.message
          : '生成失败，请检查本地模型配置后重试',
      );
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
    setExporting(true);
    try {
      await downloadGenerationWord(generationUuid);
    } catch {
      setError('Word 导出失败，请稍后重试');
    } finally {
      setExporting(false);
    }
  };

  const stop = async () => {
    if (!requestId) return;
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
          {output ? <pre>{output}</pre> : <p>完成左侧信息后，结果会在这里流式呈现。</p>}
          {syncMessage ? <p className="sync-status" role="status">{syncMessage}</p> : null}
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
