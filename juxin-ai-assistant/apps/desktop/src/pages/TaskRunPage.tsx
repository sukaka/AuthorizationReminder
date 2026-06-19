import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useState } from 'react';

import type { ModelGenerateResult, ModelProfile } from '../types/tauri';

type TaskField = {
  field_key: string;
  label: string;
  field_type: 'TEXT' | 'TEXTAREA' | 'SELECT' | 'MULTISELECT' | 'DATE' | 'NUMBER' | 'SWITCH';
  required: boolean;
  placeholder?: string;
  options?: string[];
};

export type TaskDefinition = {
  uuid: string;
  name: string;
  description: string;
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

export function TaskRunPage({ task }: { task: TaskDefinition }) {
  const desktopAvailable = Boolean(window.__TAURI_INTERNALS__);
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [profileId, setProfileId] = useState('');
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [output, setOutput] = useState('');
  const [status, setStatus] = useState<'idle' | 'preparing' | 'generating' | 'saving' | 'done'>('idle');
  const [error, setError] = useState('');
  const [requestId, setRequestId] = useState('');

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

  const generate = async () => {
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
      const currentRequestId = crypto.randomUUID();
      setRequestId(currentRequestId);
      const generated = await invoke<ModelGenerateResult>('model_generate', {
        profileId: selectedProfile.id,
        messages: prepared.messages,
        temperature: prepared.temperature,
        requestId: currentRequestId,
      });
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
      if (!completeResponse.ok) throw new Error(`COMPLETE_${completeResponse.status}`);
      setStatus('done');
      setRequestId('');
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
        <button
          className="primary-action"
          disabled={status !== 'idle' && status !== 'done'}
          onClick={generate}
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
        <span className="eyebrow">生成结果</span>
        {output ? <pre>{output}</pre> : <p>完成左侧信息后，结果会在这里流式呈现。</p>}
      </article>
    </section>
  );
}
