import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

import type { ModelProfile } from '../types/tauri';

const emptyProfile = {
  displayName: '',
  baseUrl: '',
  modelId: '',
  temperature: 0.3,
  timeoutSeconds: 60,
  isDefault: false,
  apiKey: '',
};

export function ModelProfilesPage() {
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [draft, setDraft] = useState(emptyProfile);
  const [message, setMessage] = useState('');

  const load = () => invoke<ModelProfile[]>('model_profile_list').then(setProfiles);
  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    await invoke('model_profile_upsert', { input: draft });
    setDraft(emptyProfile);
    setMessage('模型配置已保存在当前设备');
    await load();
  };

  return (
    <section className="models-page">
      <header>
        <span className="eyebrow">仅保存在当前设备</span>
        <h2>个人模型</h2>
        <p>模型地址与模型 ID 保存在本机；API Key 进入系统钥匙串，页面无法读取明文。</p>
      </header>
      <div className="models-grid">
        <div className="models-list">
          {profiles.map((profile) => (
            <article key={profile.id}>
              <div>
                <strong>{profile.displayName}</strong>
                <small>{profile.modelId}</small>
              </div>
              <span className={profile.hasApiKey ? 'secret-ready' : 'secret-missing'}>
                {profile.hasApiKey ? '密钥已配置' : '未配置'}
              </span>
              <div className="model-actions">
                <button
                  onClick={async () => {
                    const result = await invoke<{ message: string }>('model_profile_test', { profileId: profile.id });
                    setMessage(result.message);
                  }}
                  type="button"
                >测试连接</button>
                {!profile.isDefault && (
                  <button
                    onClick={async () => {
                      await invoke('model_profile_set_default', { profileId: profile.id });
                      await load();
                    }}
                    type="button"
                  >设为默认</button>
                )}
                <button
                  className="danger-link"
                  onClick={async () => {
                    await invoke('model_profile_delete', { profileId: profile.id });
                    await load();
                  }}
                  type="button"
                >删除</button>
              </div>
            </article>
          ))}
        </div>
        <form onSubmit={(event) => event.preventDefault()}>
          <label>名称<input value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} /></label>
          <label>Base URL<input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} /></label>
          <label>模型 ID<input value={draft.modelId} onChange={(event) => setDraft({ ...draft, modelId: event.target.value })} /></label>
          <label>API Key<input autoComplete="new-password" type="password" value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} /></label>
          <button className="primary-action" onClick={save} type="button">保存模型</button>
          {message && <p>{message}</p>}
        </form>
      </div>
    </section>
  );
}
