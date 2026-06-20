import { useEffect, useState } from 'react';

import {
  deleteHistory,
  getHistory,
  getHistoryDetail,
  type HistoryDetailPayload,
  type HistoryItemPayload,
} from '../api/client';
import { FeedbackPanel } from '../components/FeedbackPanel';

export function HistoryPage() {
  const [items, setItems] = useState<HistoryItemPayload[]>([]);
  const [detail, setDetail] = useState<HistoryDetailPayload | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setError('');
    getHistory({
      status: statusFilter || undefined,
      createdFrom: dateFilter ? `${dateFilter}T00:00:00` : undefined,
      createdTo: dateFilter ? `${dateFilter}T23:59:59` : undefined,
    })
      .then((payload) => {
        if (active) setItems(payload.items);
      })
      .catch(() => {
        if (active) setError('历史记录加载失败');
      });
    return () => {
      active = false;
    };
  }, [dateFilter, statusFilter]);

  const selectItem = async (item: HistoryItemPayload) => {
    setError('');
    try {
      setDetail(await getHistoryDetail(item.uuid));
    } catch {
      setError('历史详情读取失败');
    }
  };

  const remove = async () => {
    if (!detail) return;
    const uuid = detail.uuid;
    try {
      await deleteHistory(uuid);
      setItems((current) => current.filter((item) => item.uuid !== uuid));
      setDetail(null);
    } catch {
      setError('删除失败，请重试');
    }
  };

  const copy = async () => {
    if (detail?.output) await navigator.clipboard?.writeText(detail.output);
  };

  return (
    <section className="history-page">
      <header className="catalog-heading">
        <div><span className="eyebrow">仅你可见</span><h1>历史记录</h1><p>列表只显示元数据，选择后才读取加密内容。</p></div>
        <div className="history-filters">
          <select aria-label="状态筛选" onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}>
            <option value="">全部状态</option>
            <option value="COMPLETED">已完成</option>
            <option value="PREPARED">待完成</option>
            <option value="FAILED">失败</option>
          </select>
          <input aria-label="日期筛选" onChange={(event) => setDateFilter(event.target.value)} type="date" value={dateFilter} />
        </div>
      </header>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="history-layout">
        <div className="history-list">
          {items.map((item) => (
            <button className={detail?.uuid === item.uuid ? 'is-current' : ''} key={item.uuid} onClick={() => selectItem(item)} type="button">
              <span><strong>{item.task_name}</strong><small>{item.assistant_name}</small></span>
              <span><small>{new Date(item.created_at).toLocaleString()}</small><em>{item.status}</em></span>
            </button>
          ))}
          {!items.length ? <p className="empty-hint">还没有生成记录。</p> : null}
        </div>
        <article className="history-detail">
          {detail ? (
            <>
              <header><div><span className="eyebrow">{detail.assistant_name}</span><h2>{detail.task_name}</h2></div><span>{detail.model_display_name}</span></header>
              <pre>{detail.output || '本次生成没有可显示的输出'}</pre>
              <div className="history-actions">
                <button className="secondary-action" onClick={copy} type="button">复制全文</button>
                <button className="danger-action" onClick={remove} type="button">删除记录</button>
              </div>
              <FeedbackPanel generationUuid={detail.uuid} />
            </>
          ) : <div className="history-placeholder"><strong>选择一条记录</strong><span>内容将在选择后安全解密。</span></div>}
        </article>
      </div>
    </section>
  );
}
