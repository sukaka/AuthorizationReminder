import { useState } from 'react';

import { governanceApi, type AuditItem } from '../../api/governance';
import { AdminPageState, RequestNotice } from './AdminPageState';

export function AuditPage() {
  const [items, setItems] = useState<AuditItem[]>([]);
  const [notice, setNotice] = useState('');
  const [filters, setFilters] = useState({ username: '', action: '', entity: '', date_from: '', date_to: '' });
  const refresh = async () => {
    const query = new URLSearchParams({ limit: '100' });
    Object.entries(filters).forEach(([key, value]) => { if (value) query.set(key, value); });
    try { const payload = await governanceApi.audit(query.toString()); setItems(payload.items); setNotice(payload.items.length ? '' : '没有匹配的审计日志。'); }
    catch { setNotice('审计日志读取失败。'); }
  };
  return (
    <AdminPageState title="审计日志" description="只读展示已清洗元数据，不读取生成正文。">
      <form className="audit-filters" onSubmit={(event) => { event.preventDefault(); void refresh(); }}>
        <label>操作人<input value={filters.username} onChange={(event) => setFilters({ ...filters, username: event.target.value })} /></label>
        <label>动作<input value={filters.action} onChange={(event) => setFilters({ ...filters, action: event.target.value })} /></label>
        <label>对象<input value={filters.entity} onChange={(event) => setFilters({ ...filters, entity: event.target.value })} /></label>
        <label>开始日期<input type="date" value={filters.date_from} onChange={(event) => setFilters({ ...filters, date_from: event.target.value })} /></label>
        <label>结束日期<input type="date" value={filters.date_to} onChange={(event) => setFilters({ ...filters, date_to: event.target.value })} /></label>
        <button className="primary-action" type="submit">刷新日志</button>
      </form>
      <RequestNotice message={notice} />
      <div className="audit-table-wrap">
        <table className="audit-table" aria-label="AI 助手审计日志">
          <thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>结果</th><th>元数据</th></tr></thead>
          <tbody>{items.map((item) => <tr key={item.id}><td>{item.created_at}</td><td>{item.username_snapshot}</td><td>{item.action}</td><td>{item.entity_type}</td><td>{item.result}</td><td><details><summary>查看</summary><pre>{JSON.stringify(item.metadata_json || {}, null, 2)}</pre></details></td></tr>)}</tbody>
        </table>
      </div>
    </AdminPageState>
  );
}
