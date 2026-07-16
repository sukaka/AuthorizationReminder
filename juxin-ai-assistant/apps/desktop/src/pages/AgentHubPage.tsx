import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  ApiError,
  getAgentHubHealth,
  invokeHubAgent,
  listAgentMarket,
  listHubAgents,
  setAgentMarketStatus,
  type HubAgentPayload,
} from '../api/client';

type HealthItem = Record<string, unknown>;

export function AgentHubPage({ isAdmin = false }: { isAdmin?: boolean }) {
  const [agents, setAgents] = useState<HubAgentPayload[]>([]);
  const [market, setMarket] = useState<Array<Record<string, unknown>>>([]);
  const [health, setHealth] = useState<HealthItem[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [inputText, setInputText] = useState('请用三句话总结这段业务说明，并标出风险。');
  const [egressConfirmed, setEgressConfirmed] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError('');
    try {
      const [hubAgents, marketBody, healthBody] = await Promise.all([
        listHubAgents(),
        listAgentMarket().catch(() => ({ items: [], total: 0 })),
        getAgentHubHealth().catch(() => ({ items: [], total: 0, healthy: 0, overall: 'down' })),
      ]);
      setAgents(hubAgents || []);
      setMarket(marketBody.items || []);
      setHealth(healthBody.items || []);
      setSelectedId((current) => {
        if (current && hubAgents.some((a) => a.agent_id === current)) return current;
        return hubAgents[0]?.agent_id || '';
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'Agent Hub 加载失败');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const healthMap = useMemo(() => {
    const map = new Map<string, HealthItem>();
    for (const item of health) {
      const id = String(item.agent_id || '');
      if (id) map.set(id, item);
    }
    return map;
  }, [health]);

  const marketMap = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    for (const item of market) {
      const id = String(item.agent_id || '');
      if (id) map.set(id, item);
    }
    return map;
  }, [market]);

  const selected = agents.find((a) => a.agent_id === selectedId);
  const selectedHealth = selectedId ? healthMap.get(selectedId) : undefined;
  const selectedMarket = selectedId ? marketMap.get(selectedId) : undefined;
  const isExternal = Boolean(selected?.endpoint);

  const onInvoke = async () => {
    if (!selectedId) return;
    setBusy(true);
    setError('');
    setNotice('');
    setResult(null);
    try {
      const body = await invokeHubAgent(selectedId, {
        input_text: inputText,
        egress_confirmed: egressConfirmed,
        context: { source: 'agent_hub_page' },
      });
      setResult(body);
      if (body.error) {
        setError(String(body.error));
      } else {
        setNotice(`调用成功 · ${selectedId}`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.code : '调用失败');
    } finally {
      setBusy(false);
    }
  };

  const onMarketStatus = async (status: 'authorized' | 'disabled' | 'installed') => {
    if (!selectedId || !isAdmin) return;
    setBusy(true);
    setError('');
    try {
      await setAgentMarketStatus(selectedId, status);
      setNotice(`市场状态已更新为 ${status}`);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : '状态更新失败（需管理员）');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="history-page">
      <header className="catalog-heading">
        <div>
          <span className="eyebrow">7.0 Agent Hub</span>
          <h1>Agent 市场</h1>
          <p>浏览本地与外部 Agent（Kimi / 即梦等），查看健康与熔断，试调调用。</p>
        </div>
        <button type="button" className="secondary-action" onClick={() => void refresh()}>
          刷新
        </button>
      </header>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? <p className="form-success">{notice}</p> : null}

      <div className="history-layout">
        <div className="history-list">
          {agents.map((agent) => {
            const h = healthMap.get(agent.agent_id);
            const ok = h?.ok !== false;
            return (
              <button
                key={agent.agent_id}
                type="button"
                className={selectedId === agent.agent_id ? 'is-current' : ''}
                onClick={() => setSelectedId(agent.agent_id)}
              >
                <span>
                  <strong>{agent.name}</strong>
                  <small>
                    {agent.agent_id}
                    {' · '}
                    {ok ? '健康' : '异常'}
                    {h?.dry_run ? ' · dry-run' : ''}
                    {agent.endpoint ? ' · 外部' : ' · 本地'}
                  </small>
                </span>
              </button>
            );
          })}
          {!agents.length ? <p className="empty-hint">暂无已注册 Agent。</p> : null}
        </div>

        <article className="history-detail">
          {selected ? (
            <>
              <header>
                <div>
                  <span className="eyebrow">{selected.endpoint ? '外部' : '本地'}</span>
                  <h2>{selected.name}</h2>
                </div>
              </header>
              <p style={{ fontSize: 13, opacity: 0.85 }}>{selected.description}</p>
              <p style={{ fontSize: 12 }}>
                版本 {selected.version}
                {' · '}
                能力：{(selected.capabilities || []).join(', ') || '—'}
              </p>
              {selected.endpoint ? (
                <p style={{ fontSize: 12, wordBreak: 'break-all' }}>
                  端点：<code>{selected.endpoint}</code>
                </p>
              ) : null}

              <section className="artifact-sources" style={{ marginTop: 12 }} aria-label="健康状态">
                <strong>健康 / 熔断</strong>
                <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13 }}>
                  <li>状态：{String(selectedHealth?.status || selected.status || '—')}</li>
                  <li>circuit：{String(selectedHealth?.circuit_state || 'closed')}</li>
                  {selectedHealth?.latency_ms != null ? (
                    <li>延迟：{String(selectedHealth.latency_ms)} ms</li>
                  ) : null}
                  {selectedHealth?.detail ? <li>详情：{String(selectedHealth.detail)}</li> : null}
                  {selectedHealth?.auth_hint ? (
                    <li>凭证：{String(selectedHealth.auth_hint)}</li>
                  ) : null}
                  {selectedMarket ? (
                    <li>
                      市场：{String(selectedMarket.status)}
                      {selectedMarket.cost_per_call_micros != null
                        ? ` · 成本 ${String(selectedMarket.cost_per_call_micros)}µ`
                        : ''}
                    </li>
                  ) : null}
                </ul>
              </section>

              <label style={{ display: 'block', marginTop: 14 }}>
                试调输入
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  rows={4}
                  style={{ width: '100%', marginTop: 6 }}
                />
              </label>
              {isExternal ? (
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={egressConfirmed}
                    onChange={(e) => setEgressConfirmed(e.target.checked)}
                  />
                  确认出域发送（敏感内容需勾选）
                </label>
              ) : null}

              <div className="history-actions" style={{ marginTop: 12, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="primary-action"
                  disabled={busy || !selectedId}
                  onClick={() => void onInvoke()}
                >
                  {busy ? '调用中…' : '试调调用'}
                </button>
                {isAdmin ? (
                  <>
                    <button
                      type="button"
                      className="secondary-action"
                      disabled={busy}
                      onClick={() => void onMarketStatus('authorized')}
                    >
                      授权
                    </button>
                    <button
                      type="button"
                      className="secondary-action"
                      disabled={busy}
                      onClick={() => void onMarketStatus('installed')}
                    >
                      安装
                    </button>
                    <button
                      type="button"
                      className="danger-action"
                      disabled={busy}
                      onClick={() => void onMarketStatus('disabled')}
                    >
                      停用
                    </button>
                  </>
                ) : null}
              </div>

              {result ? (
                <section className="artifact-sources" style={{ marginTop: 16 }} aria-label="调用结果">
                  <strong>调用结果</strong>
                  <pre
                    style={{
                      marginTop: 8,
                      fontSize: 12,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      maxHeight: 280,
                      overflow: 'auto',
                    }}
                  >
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </section>
              ) : null}
            </>
          ) : (
            <div className="history-placeholder">
              <strong>选择一个 Agent</strong>
              <span>查看健康状态并试调。</span>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
