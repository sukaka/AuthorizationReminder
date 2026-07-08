import { useState } from 'react';

import { governanceApi, type KnowledgeItem } from '../../api/governance';
import { AdminPageState, RequestNotice } from './AdminPageState';

const CATEGORIES = ['COMPANY', 'PRODUCT', 'SERVICE', 'SALES_SCRIPT', 'DELIVERY', 'TENDER', 'FAQ', 'CASE', 'TRAINING', 'COMPLIANCE', 'TECHNICAL'];

export function KnowledgeAdminPage() {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('COMPANY');
  const [tags, setTags] = useState('');
  const [taskUuids, setTaskUuids] = useState('');
  const [selected, setSelected] = useState<KnowledgeItem | null>(null);
  const [notice, setNotice] = useState('');

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

  return (
    <AdminPageState title="知识库" description="正文仅在编辑时驻留页面；列表只展示元数据。">
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
    </AdminPageState>
  );
}
