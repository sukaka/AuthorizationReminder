import { useState } from 'react';

import { governanceApi, type StatsPayload } from '../../api/governance';
import { AdminPageState, RequestNotice } from './AdminPageState';

export function StatsPage({ manager = false }: { manager?: boolean }) {
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [notice, setNotice] = useState('');
  const refresh = async () => {
    try { setStats(await governanceApi.stats(manager)); setNotice(''); }
    catch { setNotice('统计读取失败，请确认数据范围。'); }
  };
  return (
    <AdminPageState title={manager ? '部门数据' : '全局统计'} description="统计仅聚合状态、任务、部门、时间和反馈元数据。">
      <button className="primary-action" onClick={() => void refresh()} type="button">刷新统计</button>
      <RequestNotice message={notice} />
      <div className="metric-strip">
        <div><span>生成总数</span><strong>{stats?.total ?? '—'}</strong></div>
        <div><span>完成率</span><strong>{stats?.completion_rate == null ? '—' : `${Math.round(stats.completion_rate * 100)}%`}</strong></div>
        <div><span>失败率</span><strong>{stats?.failure_rate == null ? '—' : `${Math.round(stats.failure_rate * 100)}%`}</strong></div>
      </div>
      {stats ? (
        <div className="stats-details">
          <section>
            <h2>部门分布</h2>
            <ul>{Object.entries(stats.by_department || {}).map(([name, count]) => <li key={name}><span>{name}</span><strong>{count}</strong></li>)}</ul>
          </section>
          <section>
            <h2>任务排行</h2>
            <ol>{(stats.task_ranking || []).map((item) => <li key={item.name}><span>{item.name}</span><strong>{item.count}</strong></li>)}</ol>
          </section>
          <section>
            <h2>每日趋势</h2>
            <ul>{(stats.daily_trend || []).map((item) => <li key={item.date}><span>{item.date}</span><strong>{item.count}</strong></li>)}</ul>
          </section>
          <section>
            <h2>反馈分布</h2>
            <ul>{Object.entries(stats.feedback_distribution || {}).map(([name, count]) => <li key={name}><span>{name}</span><strong>{count}</strong></li>)}</ul>
          </section>
        </div>
      ) : null}
    </AdminPageState>
  );
}
