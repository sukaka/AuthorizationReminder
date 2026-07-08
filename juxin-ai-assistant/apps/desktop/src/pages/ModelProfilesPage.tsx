import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

import {
  deleteUserModelProfile,
  getServerModelStatus,
  listUserModelProfiles,
  saveUserModelProfile,
  setDefaultUserModelProfile,
  type ServerModelStatusPayload,
  type UserModelProfilePayload,
} from '../api/chat';
import { isDesktopRuntime } from '../runtime/capabilities';
import type { ModelProfile } from '../types/tauri';

const emptyProfile = {
  displayName: '',
  baseUrl: '',
  modelId: '',
  temperature: 0.3,
  maxOutputTokens: 8192,
  maxAutoContinues: 3,
  timeoutSeconds: 300,
  isDefault: false,
  apiKey: '',
};

const emptyWebProfile = {
  displayName: '',
  baseUrl: '',
  modelId: '',
  temperature: 0.3,
  maxOutputTokens: 8192,
  timeoutSeconds: 300,
  isDefault: true,
  apiKey: '',
};

export function ModelProfilesPage() {
  const isDesktop = isDesktopRuntime();
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [draft, setDraft] = useState(emptyProfile);
  const [message, setMessage] = useState('');
  const [serverStatus, setServerStatus] = useState<ServerModelStatusPayload | null>(null);
  const [webProfiles, setWebProfiles] = useState<UserModelProfilePayload[]>([]);
  const [webDraft, setWebDraft] = useState(emptyWebProfile);

  const load = () => invoke<ModelProfile[]>('model_profile_list').then(setProfiles);
  useEffect(() => {
    if (!isDesktop) return;
    void load();
  }, [isDesktop]);

  useEffect(() => {
    if (isDesktop) return;
    getServerModelStatus()
      .then(setServerStatus)
      .catch(() => setServerStatus({
        configured: false,
        model_display_name: '',
        model_id: '',
        message: '服务端模型状态暂时不可用，请联系管理员检查服务配置。',
      }));
    listUserModelProfiles()
      .then((payload) => setWebProfiles(payload.items))
      .catch(() => setMessage('个人模型配置暂时不可用，请稍后重试'));
  }, [isDesktop]);

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

  const saveWeb = async () => {
    setMessage('保存中…');
    try {
      const saved = await saveUserModelProfile(webDraft);
      setWebProfiles((current) => [saved, ...current.filter((profile) => profile.uuid !== saved.uuid)]);
      setWebDraft(emptyWebProfile);
      setMessage('模型配置已加密保存');
    } catch (err: unknown) {
      setMessage(`保存失败：${String(err)}`);
    }
  };

  if (!isDesktop) {
    return (
      <section className="models-page">
        <header>
          <span className="eyebrow">Web 端个人模型</span>
          <h2>设置</h2>
          <p>Web 版可以配置你自己的大模型；API Key 会加密保存在服务器，不会保存在浏览器。</p>
        </header>
        <div className="models-grid">
          <div className="models-list">
            <article>
              <div>
                <strong>服务端统一模型</strong>
                <small>{serverStatus?.message || '正在读取服务端模型状态…'}</small>
              </div>
              <span className={serverStatus?.configured ? 'secret-ready' : 'secret-missing'}>
                {serverStatus?.configured ? '已配置' : '未配置'}
              </span>
              {serverStatus?.configured ? (
                <dl className="model-status-list">
                  <div>
                    <dt>模型名称</dt>
                    <dd>{serverStatus.model_display_name}</dd>
                  </div>
                  <div>
                    <dt>模型 ID</dt>
                    <dd>{serverStatus.model_id}</dd>
                  </div>
                </dl>
              ) : (
                <p>请管理员在服务器环境变量中配置服务地址、模型名称和 API Key。</p>
              )}
            </article>
            <article>
              <div>
                <strong>个人模型</strong>
                <small>未配置个人模型时，会自动使用服务端统一模型。</small>
              </div>
              <span className={webProfiles.length > 0 ? 'secret-ready' : 'secret-missing'}>
                {webProfiles.length > 0 ? `${webProfiles.length} 个` : '未配置'}
              </span>
            </article>
            {webProfiles.map((profile) => (
              <article key={profile.uuid}>
                <div>
                  <strong>{profile.display_name}</strong>
                  <small>{profile.model_id}</small>
                </div>
                <span className={profile.has_api_key ? 'secret-ready' : 'secret-missing'}>
                  {profile.is_default ? '默认模型' : profile.has_api_key ? '密钥已配置' : '未配置密钥'}
                </span>
                <div className="model-actions">
                  {!profile.is_default && (
                    <button
                      onClick={async () => {
                        const updated = await setDefaultUserModelProfile(profile.uuid);
                        setWebProfiles((current) => current.map((item) => ({
                          ...item,
                          is_default: item.uuid === updated.uuid,
                        })));
                        setMessage('已设为默认模型');
                      }}
                      type="button"
                    >设为默认</button>
                  )}
                  <button
                    className="danger-link"
                    onClick={async () => {
                      await deleteUserModelProfile(profile.uuid);
                      setWebProfiles((current) => current.filter((item) => item.uuid !== profile.uuid));
                      setMessage('模型配置已删除');
                    }}
                    type="button"
                  >删除</button>
                </div>
              </article>
            ))}
          </div>
          <form onSubmit={(event) => event.preventDefault()}>
            <label>名称<input value={webDraft.displayName} onChange={(event) => setWebDraft({ ...webDraft, displayName: event.target.value })} /></label>
            <label>服务地址<input value={webDraft.baseUrl} onChange={(event) => setWebDraft({ ...webDraft, baseUrl: event.target.value })} /></label>
            <label>模型名称<input value={webDraft.modelId} onChange={(event) => setWebDraft({ ...webDraft, modelId: event.target.value })} /></label>
            <label>最大输出长度<input min={1} max={200000} type="number" value={webDraft.maxOutputTokens} onChange={(event) => setWebDraft({ ...webDraft, maxOutputTokens: Number(event.target.value) })} /></label>
            <label>生成超时时间（秒）<input min={5} max={600} type="number" value={webDraft.timeoutSeconds} onChange={(event) => setWebDraft({ ...webDraft, timeoutSeconds: Number(event.target.value) })} /></label>
            <label>API Key<input autoComplete="new-password" type="password" value={webDraft.apiKey} onChange={(event) => setWebDraft({ ...webDraft, apiKey: event.target.value })} /></label>
            <button className="primary-action" onClick={saveWeb} type="button">保存设置</button>
            {message && <p>{message}</p>}
          </form>
        </div>
      </section>
    );
  }

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
          <label>生成超时时间（秒）<input min={5} max={600} type="number" value={draft.timeoutSeconds} onChange={(event) => setDraft({ ...draft, timeoutSeconds: Number(event.target.value) })} /></label>
          <label>API Key<input autoComplete="new-password" type="password" value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} /></label>
          <button className="primary-action" onClick={save} type="button">保存设置</button>
          {message && <p>{message}</p>}
        </form>
      </div>
    </section>
  );
}
