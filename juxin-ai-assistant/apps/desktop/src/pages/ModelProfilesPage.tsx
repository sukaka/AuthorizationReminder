import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

import type { ModelProfile } from '../types/tauri';

const emptyProfile = {
  displayName: '',
  baseUrl: '',
  modelId: '',
  temperature: 0.3,
  maxOutputTokens: 8192,
  maxAutoContinues: 3,
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
    setMessage('保存中…');
    try {
      await invoke('model_profile_upsert', { input: draft });
      setDraft(emptyProfile);
      setMessage('模型配置已保存在当前设备');
      await load();
    } catch (err: unknown) {
      setMessage(`保存失败：${String(err)}`);
    }
  };

  return (
    <section className="models-page">
      <header>
        <span className="eyebrow">仅保存在当前设备</span>
        <h2>设置</h2>
        <p>在这里配置你的个人使用设置；密钥会加密保存在本机，页面无法读取明文。</p>
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
                    setMessage('测试中…');
                    try {
                      const result = await invoke<{ message: string }>('model_profile_test', { profileId: profile.id });
                      setMessage(result.message);
                    } catch (err: unknown) {
                      setMessage(String(err));
                    }
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
          <label>服务地址<input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} /></label>
          <label>模型名称<input value={draft.modelId} onChange={(event) => setDraft({ ...draft, modelId: event.target.value })} /></label>
          <label>最大输出长度<input min={1} max={200000} type="number" value={draft.maxOutputTokens} onChange={(event) => setDraft({ ...draft, maxOutputTokens: Number(event.target.value) })} /></label>
          <label>自动续写次数<input min={0} max={10} type="number" value={draft.maxAutoContinues} onChange={(event) => setDraft({ ...draft, maxAutoContinues: Number(event.target.value) })} /></label>
          <label>API Key<input autoComplete="new-password" type="password" value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} /></label>
          <button className="primary-action" onClick={save} type="button">保存设置</button>
          {message && <p>{message}</p>}
        </form>
      </div>
    </section>
  );
}
