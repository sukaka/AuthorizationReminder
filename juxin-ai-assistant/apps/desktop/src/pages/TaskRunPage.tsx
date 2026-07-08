import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ModelGenerateResult, ModelProfile } from '../types/tauri';

type TaskField = {
  field_key: string;
  label: string;
  field_type:
    | 'TEXT'
    | 'TEXTAREA'
    | 'SELECT'
    | 'MULTISELECT'
    | 'DATE'
    | 'NUMBER'
    | 'SWITCH'
    | 'FILE_RESERVED';
  required: boolean;
  placeholder?: string;
  example?: string;
  options?: string[];
  validation?: Record<string, unknown>;
};

export type TaskDefinition = {
  uuid: string;
  code?: string;
  name: string;
  description: string;
  output_format?: string;
  safety_notice: string;
  fields: TaskField[];
};

type PreparedGeneration = {
  generation_uuid: string;
  completion_token: string;
  messages: Array<{ role: string; content: string }>;
  temperature: number;
  safety_notice: string;
};

type GenerationMetrics = {
  latencyMs: number;
  usage: Record<string, number>;
};

function usageValue(usage: Record<string, number>, ...keys: string[]) {
  return keys.reduce((total, key) => total + Number(usage[key] || 0), 0);
}

function totalTokenCount(usage: Record<string, number>) {
  return Number(usage.total_tokens || usage.totalTokens || 0)
    || usageValue(usage, 'input_tokens', 'prompt_tokens', 'output_tokens', 'completion_tokens');
}

function outputTokenCount(usage: Record<string, number>) {
  return usageValue(usage, 'output_tokens', 'completion_tokens');
}

function formatLatency(latencyMs: number) {
  return `${(Math.max(0, latencyMs) / 1000).toFixed(2)} 秒`;
}

function formatCount(value: number) {
  return new Intl.NumberFormat('zh-CN').format(Math.max(0, Math.round(value)));
}

export function TaskRunPage({ task }: { task: TaskDefinition; userId?: string }) {
  const desktopAvailable = Boolean(window.__TAURI_INTERNALS__);
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [profileId, setProfileId] = useState('');
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [output, setOutput] = useState('');
  const [status, setStatus] = useState<'idle' | 'preparing' | 'generating' | 'stopping' | 'saving' | 'done'>('idle');
  const [error, setError] = useState('');
  const [requestId, setRequestId] = useState('');
  const [metrics, setMetrics] = useState<GenerationMetrics | null>(null);
  const stoppedRequestRef = useRef('');

  useEffect(() => {
    if (!desktopAvailable) return;
    invoke<ModelProfile[]>('model_profile_list')
      .then((items) => {
        setProfiles(items);
        setProfileId(items.find((profile) => profile.isDefault)?.id || items[0]?.id || '');
      })
      .catch(() => setError('无法读取当前设备的模型配置'));
  }, [desktopAvailable]);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === profileId),
    [profileId, profiles],
  );

  const setValue = (fieldKey: string, value: string | boolean) => {
    setValues((current) => ({ ...current, [fieldKey]: value }));
  };

  const stop = useCallback(async () => {
    if (!requestId || status !== 'generating') return;
    stoppedRequestRef.current = requestId;
    setStatus('stopping');
    try {
      await invoke('model_cancel', { requestId });
    } catch {
      stoppedRequestRef.current = '';
      setStatus('generating');
      setError('停止生成失败，请稍后再试');
    }
  }, [requestId, status]);

  useEffect(() => {
    if (status !== 'generating') return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      void stop();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [status, stop]);

  const generate = async () => {
    setError('');
    setMetrics(null);
    setOutput('');
    stoppedRequestRef.current = '';
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

    let currentRequestId = '';
    try {
      setStatus('preparing');
      const prepareResponse = await fetch('/api/ai/generations/prepare', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_uuid: task.uuid, inputs: values }),
      });
      if (!prepareResponse.ok) throw new Error(`PREPARE_${prepareResponse.status}`);
      const prepared = (await prepareResponse.json()) as PreparedGeneration;

      setStatus('generating');
      currentRequestId = crypto.randomUUID();
      setRequestId(currentRequestId);
      const generated = await invoke<ModelGenerateResult>('model_generate', {
        profileId: selectedProfile.id,
        messages: prepared.messages,
        temperature: prepared.temperature,
        requestId: currentRequestId,
      });
      if (stoppedRequestRef.current === currentRequestId) {
        setStatus('idle');
        setRequestId('');
        setError('已停止生成');
        stoppedRequestRef.current = '';
        return;
      }
      setOutput(generated.output);
      setMetrics({ latencyMs: generated.latencyMs, usage: generated.usage });

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
      if (!completeResponse.ok) throw new Error(`COMPLETE_${completeResponse.status}`);
      setStatus('done');
      setRequestId('');
    } catch (generationError) {
      if (currentRequestId && stoppedRequestRef.current === currentRequestId) {
        setStatus('idle');
        setRequestId('');
        setError('已停止生成');
        stoppedRequestRef.current = '';
        return;
      }
      setStatus('idle');
      setRequestId('');
      setError(
        generationError instanceof Error
          ? generationError.message
          : '生成失败，请检查本地模型配置后重试',
      );
    }
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

  const generationActive = status === 'generating' || status === 'stopping';
  const totalTokens = metrics ? totalTokenCount(metrics.usage) : 0;
  const outputTokens = metrics ? outputTokenCount(metrics.usage) : 0;

  return (
    <section className="task-run-layout">
      <aside className="task-brief">
        <span className="eyebrow">当前任务</span>
        <h2>{task.name}</h2>
        <p>{task.description}</p>
        <div className="safety-note">{task.safety_notice}</div>
      </aside>

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

        {task.fields.map((field) => (
          <label className="dynamic-field" key={field.field_key}>
            <span>{field.label}{field.required ? ' *' : ''}</span>
            {field.field_type === 'TEXTAREA' ? (
              <textarea
                aria-label={field.label}
                onChange={(event) => setValue(field.field_key, event.target.value)}
                placeholder={field.placeholder}
                rows={8}
              />
            ) : field.field_type === 'SELECT' ? (
              <select
                aria-label={field.label}
                onChange={(event) => setValue(field.field_key, event.target.value)}
              >
                <option value="">请选择</option>
                {field.options?.map((option) => <option key={option}>{option}</option>)}
              </select>
            ) : field.field_type === 'SWITCH' ? (
              <input
                aria-label={field.label}
                onChange={(event) => setValue(field.field_key, event.target.checked)}
                type="checkbox"
              />
            ) : field.field_type === 'FILE_RESERVED' ? (
              <input
                aria-label={field.label}
                disabled
                placeholder={field.placeholder || '文件上传会在任务资料区处理'}
                type="text"
              />
            ) : (
              <input
                aria-label={field.label}
                onChange={(event) => setValue(field.field_key, event.target.value)}
                placeholder={field.placeholder}
                type={field.field_type === 'DATE' ? 'date' : field.field_type === 'NUMBER' ? 'number' : 'text'}
              />
            )}
          </label>
        ))}

        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="generation-actions">
          {generationActive ? (
            <>
              <span className="generation-hint">
                {status === 'stopping' ? '正在停止…' : '正在生成，按 Esc 或点击停止'}
              </span>
              <button
                aria-label="停止生成"
                className="stop-action"
                disabled={status === 'stopping'}
                onClick={stop}
                title="停止生成（Esc）"
                type="button"
              >
                <span aria-hidden="true" />
              </button>
            </>
          ) : (
            <button
              className="primary-action"
              disabled={status !== 'idle' && status !== 'done'}
              onClick={generate}
              type="button"
            >
              {status === 'preparing'
                ? '正在准备…'
                : status === 'saving'
                  ? '正在保存…'
                  : '开始生成'}
            </button>
          )}
        </div>
      </form>

      <article className="result-panel">
        <div className="result-panel-header">
          <span className="eyebrow">生成结果</span>
          {metrics && (
            <div className="generation-metrics" aria-label="生成指标">
              <span>耗时 {formatLatency(metrics.latencyMs)}</span>
              <span>Token {formatCount(totalTokens)}</span>
              <span>输出 {formatCount(outputTokens)}</span>
            </div>
          )}
        </div>
        <div className="generation-steps" aria-label="任务进度">
          <span className={status === 'preparing' ? 'is-active' : 'is-done'}>识别任务</span>
          <span className={status === 'generating' || status === 'stopping' ? 'is-active' : output || metrics ? 'is-done' : ''}>生成回答</span>
          <span className={status === 'saving' ? 'is-active' : metrics ? 'is-done' : ''}>保存记录</span>
          <span className={status === 'done' ? 'is-done' : ''}>等待确认</span>
        </div>
        {output ? <pre>{output}</pre> : <p>完成左侧信息后，结果会在这里流式呈现。</p>}
      </article>
    </section>
  );
}
