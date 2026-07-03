import { useCallback, useEffect, useRef, useState } from 'react';

import { desktopUpdateApi, type DesktopUpdateRelease } from '../../api/governance';

type ViewState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; releases: DesktopUpdateRelease[] };

export function DesktopUpdatesPage() {
  const [view, setView] = useState<ViewState>({ kind: 'loading' });
  const [statusMsg, setStatusMsg] = useState('');
  const [creating, setCreating] = useState(false);
  const [version, setVersion] = useState('');
  const [channel, setChannel] = useState<'lan-test' | 'production'>('lan-test');
  const [notes, setNotes] = useState('');
  const [uploadTarget, setUploadTarget] = useState('');
  const [uploadReleaseUuid, setUploadReleaseUuid] = useState('');
  const [uploadSha, setUploadSha] = useState('');
  const [uploadSig, setUploadSig] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setView({ kind: 'loading' });
    try {
      const releases = await desktopUpdateApi.list();
      setView({ kind: 'ready', releases });
    } catch (err) {
      setView({ kind: 'error', message: err instanceof Error ? err.message : '加载失败' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    if (!version.trim()) return;
    setCreating(true);
    setStatusMsg('');
    try {
      await desktopUpdateApi.create({
        agent_version: version.trim(),
        channel,
        release_notes: notes.trim(),
      });
      setVersion('');
      setNotes('');
      await load();
      setStatusMsg('创建成功');
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file || !uploadReleaseUuid || !uploadTarget || !uploadSha.trim() || !uploadSig.trim()) return;
    setStatusMsg('正在上传...');
    try {
      await desktopUpdateApi.upload(uploadReleaseUuid, file, uploadTarget, uploadSha.trim(), uploadSig.trim());
      setUploadTarget('');
      setUploadSha('');
      setUploadSig('');
      if (fileRef.current) fileRef.current.value = '';
      await load();
      setStatusMsg('上传成功，已校验 SHA-256');
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : '上传失败');
    }
  };

  const handlePublish = async (uuid: string) => {
    if (!confirm('确认发布此更新？发布后不可修改。')) return;
    try {
      await desktopUpdateApi.publish(uuid);
      await load();
      setStatusMsg('已发布');
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : '发布失败');
    }
  };

  const handleWithdraw = async (uuid: string) => {
    if (!confirm('确认撤回此更新？')) return;
    try {
      await desktopUpdateApi.withdraw(uuid);
      await load();
      setStatusMsg('已撤回');
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : '撤回失败');
    }
  };

  if (view.kind === 'loading') return <p>加载中…</p>;
  if (view.kind === 'error') return <p role="alert">{view.message}</p>;

  return (
    <section className="desktop-updates-page" aria-label="桌面端更新管理">
      <h2>桌面端更新发布</h2>

      {statusMsg ? <p className="status-msg" role="status">{statusMsg}</p> : null}

      <div className="create-release">
        <h3>创建更新草稿</h3>
        <label>
          助手版本
          <input
            onChange={(e) => setVersion(e.target.value)}
            placeholder="1.0.1"
            value={version}
          />
        </label>
        <label>
          发布渠道
          <select onChange={(e) => setChannel(e.target.value as 'lan-test' | 'production')} value={channel}>
            <option value="lan-test">内网测试版</option>
            <option value="production">正式版</option>
          </select>
        </label>
        <label>
          更新说明
          <input
            onChange={(e) => setNotes(e.target.value)}
            placeholder="版本更新内容"
            value={notes}
          />
        </label>
        <button disabled={creating || !version.trim()} onClick={() => void handleCreate()} type="button">
          {creating ? '创建中…' : '创建更新草稿'}
        </button>
      </div>

      <div className="upload-artifact">
        <h3>上传更新产物</h3>
        <label>
          目标发布
          <select onChange={(e) => setUploadReleaseUuid(e.target.value)} value={uploadReleaseUuid}>
            <option value="">选择草稿版本</option>
            {view.releases
              .filter((r) => r.status === 'DRAFT')
              .map((r) => (
                <option key={r.uuid} value={r.uuid}>
                  v{r.agent_version} ({r.channel})
                </option>
              ))}
          </select>
        </label>
        <label>
          平台目标
          <select onChange={(e) => setUploadTarget(e.target.value)} value={uploadTarget}>
            <option value="">选择平台</option>
            <option value="darwin-aarch64">macOS arm64 (.app.tar.gz)</option>
            <option value="windows-x86_64">Windows x64 (.nsis.zip)</option>
          </select>
        </label>
        <label>
          SHA-256
          <input
            maxLength={64}
            minLength={64}
            onChange={(e) => setUploadSha(e.target.value)}
            pattern="[a-f0-9]{64}"
            placeholder="64位十六进制"
            value={uploadSha}
          />
        </label>
        <label>
          Tauri 签名
          <input
            onChange={(e) => setUploadSig(e.target.value)}
            placeholder="签名内容"
            value={uploadSig}
          />
        </label>
        <label>
          更新产物文件
          <input ref={fileRef} type="file" />
        </label>
        <button
          disabled={!uploadReleaseUuid || !uploadTarget || !uploadSha.trim() || !uploadSig.trim() || !fileRef.current?.files?.[0]}
          onClick={() => void handleUpload()}
          type="button"
        >
          上传并校验
        </button>
      </div>

      <div className="releases-list">
        <h3>发布列表</h3>
        {view.releases.length === 0 ? (
          <p>暂无更新发布记录。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>版本</th>
                <th>渠道</th>
                <th>状态</th>
                <th>产物</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {view.releases.map((r) => (
                <tr key={r.uuid}>
                  <td>v{r.agent_version}</td>
                  <td>{r.channel === 'lan-test' ? '内网测试' : '正式'}</td>
                  <td>
                    {r.status === 'DRAFT' ? '草稿' : r.status === 'PUBLISHED' ? '已发布' : '已撤回'}
                  </td>
                  <td>
                    {r.artifacts.length > 0
                      ? r.artifacts.map((a) => a.target).join(', ')
                      : '无'}
                  </td>
                  <td className="release-actions">
                    {r.status === 'DRAFT' ? (
                      <button
                        disabled={r.artifacts.length === 0}
                        onClick={() => void handlePublish(r.uuid)}
                        type="button"
                      >
                        发布{channel === 'production' && r.artifacts.length < 2 ? '（需双平台产物）' : ''}
                      </button>
                    ) : null}
                    {r.status === 'PUBLISHED' ? (
                      <button onClick={() => void handleWithdraw(r.uuid)} type="button">
                        撤回
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
