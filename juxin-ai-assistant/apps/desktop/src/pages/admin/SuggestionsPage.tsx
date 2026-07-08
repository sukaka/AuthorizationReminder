import { useState } from 'react';

import { governanceApi, type Suggestion } from '../../api/governance';
import { AdminPageState, RequestNotice } from './AdminPageState';

export function SuggestionsPage({ departments, admin = false }: { departments: string[]; admin?: boolean }) {
  const [department, setDepartment] = useState(departments[0] || '');
  const [content, setContent] = useState('');
  const [notice, setNotice] = useState('');
  const [items, setItems] = useState<Suggestion[]>([]);
  const refresh = async () => {
    try {
      const payload = await governanceApi.suggestions();
      setItems(payload.items);
      setNotice(payload.items.length ? '' : '暂无待审核建议。');
    } catch { setNotice('建议读取失败，请确认治理权限。'); }
  };
  const review = async (uuid: string, decision: 'APPROVE' | 'REJECT') => {
    try {
      await governanceApi.reviewSuggestion(uuid, decision);
      setItems((current) => current.filter((item) => item.uuid !== uuid));
      setNotice(decision === 'APPROVE' ? '建议已批准，仅记录决策，尚未修改任务。' : '建议已驳回。');
    } catch { setNotice('审核失败，该建议可能已进入终态。'); }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await governanceApi.submitSuggestion({ department_code: department, suggestion_type: 'COMMON_TASK_CHANGE', content });
      setContent('');
      setNotice('建议已提交，等待管理员审核。');
    } catch { setNotice('建议提交失败，请检查部门范围。'); }
  };
  return (
    <AdminPageState title={admin ? '建议审核' : '提交建议'} description="建议只进入审核队列，不会直接修改任务或内容模板。">
      {admin ? (
        <>
          <button className="secondary-action" onClick={() => void refresh()} type="button">刷新待审核建议</button>
          <div className="suggestion-list">
            {items.map((item) => (
              <article key={item.uuid}>
                <div><strong>{item.department_code}</strong><span>{item.suggestion_type}{item.task_uuid ? ` · ${item.task_uuid}` : ''}</span>{item.content ? <p>{item.content}</p> : null}</div>
                <div className="suggestion-actions">
                  <button onClick={() => void review(item.uuid, 'REJECT')} type="button">驳回</button>
                  <button className="primary-action" onClick={() => void review(item.uuid, 'APPROVE')} type="button">批准</button>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : <form className="settings-form" onSubmit={(event) => void submit(event)}>
        <label>负责部门<select value={department} onChange={(event) => setDepartment(event.target.value)}>{departments.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>建议内容<textarea required value={content} onChange={(event) => setContent(event.target.value)} /></label>
        <button className="primary-action" disabled={!department} type="submit">提交审核</button>
      </form>}
      <RequestNotice message={notice} />
    </AdminPageState>
  );
}
