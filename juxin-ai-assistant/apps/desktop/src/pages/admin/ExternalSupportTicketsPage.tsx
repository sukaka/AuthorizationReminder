import { useEffect, useState } from 'react';

import { governanceApi, type ExternalSupportTicket } from '../../api/governance';
import { AdminPageState, RequestNotice } from './AdminPageState';

const STATUS_LABELS: Record<ExternalSupportTicket['status'], string> = {
  PENDING: '待认领', ASSIGNED: '处理中', REPLIED: '已回复', RESOLVED: '已解决', CLOSED: '已关闭',
};

const CHANNEL_LABELS: Record<string, string> = {
  wecom_kf: '企业微信客服',
  wechat_official: '微信公众号',
};

function formatTime(value: string | null): string {
  return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
}

export function ExternalSupportTicketsPage() {
  const [items, setItems] = useState<ExternalSupportTicket[]>([]);
  const [selectedUuid, setSelectedUuid] = useState('');
  const [filter, setFilter] = useState<ExternalSupportTicket['status'] | 'ALL'>('PENDING');
  const [reply, setReply] = useState('');
  const [resolve, setResolve] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const selected = items.find((item) => item.uuid === selectedUuid) || items[0] || null;

  const load = async (status = filter) => {
    setBusy(true);
    try {
      const payload = await governanceApi.externalSupportTickets(status === 'ALL' ? undefined : status);
      setItems(payload.items);
      setSelectedUuid((current) => payload.items.some((item) => item.uuid === current) ? current : (payload.items[0]?.uuid || ''));
      setNotice('');
    } catch {
      setNotice('工单加载失败，请确认管理员权限后重试。');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { void load(); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const replace = (updated: ExternalSupportTicket) => {
    setItems((current) => current.map((item) => item.uuid === updated.uuid ? updated : item));
    setSelectedUuid(updated.uuid);
  };

  const claim = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      replace(await governanceApi.claimExternalSupportTicket(selected.uuid));
      setNotice('已认领，回复后将发送给客户。');
    } catch {
      setNotice('认领失败，工单可能已被其他人员处理。');
    } finally {
      setBusy(false);
    }
  };

  const sendReply = async () => {
    if (!selected || !reply.trim()) return;
    setBusy(true);
    try {
      replace(await governanceApi.replyExternalSupportTicket(selected.uuid, reply.trim(), resolve));
      setReply('');
      setResolve(false);
      setNotice(resolve ? '回复已发送，工单已关闭。' : '回复已发送给客户。');
    } catch {
      setNotice('回复发送失败，请确认工单已由你认领。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminPageState title="外部客户工单" description="仅在已鉴权后台展示客户问题明文；认领后由对应人员回复，发送状态全程留痕。">
      <div className="support-ticket-toolbar">
        <label>工单状态
          <select aria-label="工单状态" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
            <option value="PENDING">待认领</option><option value="ASSIGNED">处理中</option><option value="REPLIED">已回复</option><option value="RESOLVED">已解决</option><option value="CLOSED">已关闭</option><option value="ALL">全部</option>
          </select>
        </label>
        <button className="secondary-action" disabled={busy} onClick={() => void load()} type="button">刷新工单</button>
      </div>
      <RequestNotice message={notice} />
      <div className="support-ticket-workspace">
        <aside aria-label="工单列表" className="support-ticket-list">
          {items.map((item) => (
            <button aria-current={selected?.uuid === item.uuid ? 'true' : undefined} className={selected?.uuid === item.uuid ? 'is-selected' : ''} key={item.uuid} onClick={() => { setSelectedUuid(item.uuid); setReply(''); }} type="button">
              <span className={`support-ticket-status status-${item.status.toLowerCase()}`}>{STATUS_LABELS[item.status]}</span>
              <strong>{item.question || '客户问题已加密'}</strong>
              <small>{CHANNEL_LABELS[item.source_channel] || item.source_channel} · {formatTime(item.created_at)}</small>
            </button>
          ))}
          {!busy && !items.length ? <p className="empty-hint">该状态下暂无工单。</p> : null}
        </aside>
        <section aria-label="工单详情" className="support-ticket-detail">
          {selected ? <>
            <header className="support-ticket-heading">
              <div><span className="eyebrow">{CHANNEL_LABELS[selected.source_channel] || selected.source_channel}</span><h2>客户问题</h2></div>
              <span className={`support-ticket-status status-${selected.status.toLowerCase()}`}>{STATUS_LABELS[selected.status]}</span>
            </header>
            <p className="support-ticket-question">{selected.question}</p>
            <dl className="support-ticket-meta"><div><dt>转人工原因</dt><dd>{selected.reason_code}</dd></div><div><dt>创建时间</dt><dd>{formatTime(selected.created_at)}</dd></div><div><dt>处理人</dt><dd>{selected.assigned_to || '尚未认领'}</dd></div></dl>
            <section aria-label="回复记录" className="support-ticket-thread">
              <h3>回复记录</h3>
              {selected.messages.length ? selected.messages.map((message) => <article key={message.uuid}><p>{message.message}</p><small>{formatTime(message.created_at)} · {message.delivery_status}</small></article>) : <p className="empty-hint">尚未发送回复。</p>}
            </section>
            {selected.status === 'PENDING' ? <button className="primary-action" disabled={busy} onClick={() => void claim()} type="button">认领工单</button> : null}
            {selected.status === 'ASSIGNED' || selected.status === 'REPLIED' ? <form className="support-ticket-reply" onSubmit={(event) => { event.preventDefault(); void sendReply(); }}>
              <label>回复客户<textarea aria-label="回复客户" maxLength={2000} placeholder="输入准确、可执行的回复…" required value={reply} onChange={(event) => setReply(event.target.value)} /></label>
              <label className="support-ticket-resolve"><input aria-label="回复后关闭工单" checked={resolve} onChange={(event) => setResolve(event.target.checked)} type="checkbox" />回复后关闭工单</label>
              <button className="primary-action" disabled={busy || !reply.trim()} type="submit">发送回复</button>
            </form> : null}
          </> : <p className="empty-hint">选择一条工单查看客户问题与处理记录。</p>}
        </section>
      </div>
    </AdminPageState>
  );
}
