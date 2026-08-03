import { useState } from 'react';

import { apiFetch } from '../../api/client';
import { governanceApi, type KnowledgeItem } from '../../api/governance';
import { AdminPageState, RequestNotice } from './AdminPageState';

const CATEGORIES = ['COMPANY', 'PRODUCT', 'SERVICE', 'SALES_SCRIPT', 'DELIVERY', 'TENDER', 'FAQ', 'CASE', 'TRAINING', 'COMPLIANCE', 'TECHNICAL'];

type VersionItem = {
  file_uuid: string;
  file_name: string;
  version: number;
  is_current_version: boolean;
  review_status: string;
  summary: string;
};

export function KnowledgeAdminPage() {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('COMPANY');
  const [tags, setTags] = useState('');
  const [taskUuids, setTaskUuids] = useState('');
  const [selected, setSelected] = useState<KnowledgeItem | null>(null);
  const [notice, setNotice] = useState('');
  const [versionFileUuid, setVersionFileUuid] = useState('');
  const [versionItems, setVersionItems] = useState<VersionItem[]>([]);
  const [effectiveUuid, setEffectiveUuid] = useState('');

  const refresh = async () => {
    try {
      const payload = await governanceApi.knowledge();
      setItems(payload.items);
      setNotice('');
    } catch { setNotice('无法读取知识库，请确认治理权限。'); }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const payload = {
        title,
        category,
        content,
        tags: tags.split(',').map((value) => value.trim()).filter(Boolean),
        keywords: tags.split(',').map((value) => value.trim()).filter(Boolean),
        task_uuids: taskUuids.split(',').map((value) => value.trim()).filter(Boolean),
        priority: 0,
      };
      if (selected) await governanceApi.updateKnowledge(selected.uuid, payload);
      else await governanceApi.createKnowledge(payload);
      setContent('');
      setTitle('');
      setTags('');
      setTaskUuids('');
      setSelected(null);
      setNotice('知识已加密保存，编辑区已清空。');
      await refresh();
    } catch { setNotice('保存失败，请检查内容与关联任务。'); }
  };

  const edit = (item: KnowledgeItem) => {
    setSelected(item);
    setTitle(item.title);
    setCategory(item.category);
    setTags(item.tags.join(', '));
    setTaskUuids(item.task_uuids.join(', '));
    setContent('');
    setNotice('请输入新的正文后保存；已加密正文不会回填到列表。');
  };

  const disable = async () => {
    if (!selected) return;
    try {
      await governanceApi.disableKnowledge(selected.uuid);
      setSelected(null);
      setContent('');
      setNotice('知识已停用，不再参与检索。');
      await refresh();
    } catch { setNotice('停用失败。'); }
  };

  const loadVersions = async () => {
    const uuid = versionFileUuid.trim();
    if (!uuid) {
      setNotice('请输入知识文件 UUID');
      return;
    }
    try {
      const response = await apiFetch(`/api/ai/knowledge/files/${encodeURIComponent(uuid)}/versions`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        setNotice('版本时间线加载失败（文件不存在或无权限）');
        setVersionItems([]);
        return;
      }
      const body = await response.json();
      setVersionItems(body.items || []);
      setEffectiveUuid(body.effective_uuid || '');
      setNotice(`已加载 ${body.total || 0} 个版本，生效：${(body.effective_uuid || '').slice(0, 8)}`);
    } catch {
      setNotice('版本时间线请求失败');
    }
  };

  const activateVersion = async (fileUuid: string) => {
    try {
      const response = await apiFetch(
        `/api/ai/knowledge/files/${encodeURIComponent(fileUuid)}/versions/activate`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: 'admin activate' }) },
      );
      if (!response.ok) {
        setNotice('切换生效版本失败（需要管理员权限）');
        return;
      }
      const body = await response.json();
      setVersionItems(body.items || []);
      setEffectiveUuid(body.effective_uuid || '');
      setNotice('已切换生效版本');
    } catch {
      setNotice('切换生效版本失败');
    }
  };

  return (
    <AdminPageState title="知识库" description="正文仅在编辑时驻留页面；列表只展示元数据。支持文档版本时间线。">
      <button className="secondary-action" onClick={() => void refresh()} type="button">刷新元数据</button>
      <RequestNotice message={notice} />
      <div className="governance-split">
        <div className="governance-list">{items.map((item) => <button key={item.uuid} onClick={() => edit(item)} type="button"><strong>{item.title}</strong><span>{item.category} · {item.status}</span></button>)}</div>
        <form className="governance-editor" onSubmit={(event) => void save(event)}>
          <h2>{selected ? '编辑知识' : '新增知识'}</h2>
          <label>标题<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>分类<select value={category} onChange={(event) => setCategory(event.target.value)}>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>标签与关键词<input placeholder="逗号分隔" value={tags} onChange={(event) => setTags(event.target.value)} /></label>
          <label>关联任务 UUID<input placeholder="逗号分隔" value={taskUuids} onChange={(event) => setTaskUuids(event.target.value)} /></label>
          <label>正文<textarea required placeholder={selected ? '为保护密文，请输入更新后的完整正文' : ''} value={content} onChange={(event) => setContent(event.target.value)} /></label>
          <button className="primary-action" type="submit">加密保存</button>
          {selected ? <button className="danger-action" onClick={() => void disable()} type="button">停用知识</button> : null}
        </form>
      </div>
      <section className="governance-version-section">
        <h2>知识文件版本时间线</h2>
        <p className="governance-version-hint">输入 `KnowledgeFile` UUID，查看版本链并切换生效版本（RAG 以 is_current_version 为准）。</p>
        <div className="governance-version-toolbar">
          <input
            className="governance-version-input"
            placeholder="file uuid"
            value={versionFileUuid}
            onChange={(e) => setVersionFileUuid(e.target.value)}
          />
          <button className="secondary-action" type="button" onClick={() => void loadVersions()}>加载版本</button>
        </div>
        {versionItems.length ? (
          <ul className="governance-version-list">
            {versionItems.map((v) => (
              <li
                key={v.file_uuid}
                className={`governance-version-item${v.file_uuid === effectiveUuid ? ' is-effective' : ''}`}
              >
                <strong>V{v.version}</strong> · {v.file_name || v.file_uuid.slice(0, 8)}
                {v.is_current_version || v.file_uuid === effectiveUuid ? ' · 生效中' : ''}
                <div className="governance-version-meta">{v.summary || v.review_status}</div>
                {!v.is_current_version && v.file_uuid !== effectiveUuid ? (
                  <button
                    type="button"
                    className="secondary-action governance-version-activate"
                    onClick={() => void activateVersion(v.file_uuid)}
                  >
                    设为生效
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </AdminPageState>
  );
}
