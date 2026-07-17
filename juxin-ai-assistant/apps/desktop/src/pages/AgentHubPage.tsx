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

import './agent-hub.css';

type HealthItem = Record<string, unknown>;
type AgentSourceFilter = 'all' | 'local' | 'external';

const MARKET_STATUS_LABELS: Record<string, string> = {
  installed: '已安装',
  authorized: '已授权',
  disabled: '已停用',
};

const CIRCUIT_STATUS_LABELS: Record<string, string> = {
  closed: '正常',
  open: '已熔断',
  half_open: '恢复探测',
};

function getHealthLabel(health: HealthItem | undefined, fallbackStatus: string) {
  if (health?.ok === false) return '运行异常';
  const status = String(health?.status || fallbackStatus || '').toLowerCase();
  if (['ok', 'healthy', 'available', 'ready'].includes(status)) return '运行正常';
  if (['down', 'failed', 'error', 'unavailable'].includes(status)) return '运行异常';
  if (health?.ok === true) return '运行正常';
  return status || '待检测';
}

function isAgentHealthy(health: HealthItem | undefined, fallbackStatus: string) {
  return getHealthLabel(health, fallbackStatus) === '运行正常';
}

function getMarketStatusLabel(value: unknown) {
  const status = String(value || '');
  return MARKET_STATUS_LABELS[status] || status || '未上架';
}

function AgentMark({ external, label }: { external: boolean; label: string }) {
  return (
    <span className={`agent-hub-mark ${external ? 'is-external' : 'is-local'}`} aria-hidden="true">
      {external ? '↗' : label.trim().slice(0, 1).toUpperCase() || 'A'}
    </span>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M15.6 6.1A6.4 6.4 0 1 0 16.3 12" />
      <path d="M15.7 2.9v3.7h-3.8" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8.7" cy="8.7" r="5.2" />
      <path d="m12.7 12.7 4 4" />
    </svg>
  );
}

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
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<AgentSourceFilter>('all');
  const [rawResultOpen, setRawResultOpen] = useState(false);

  const refresh = useCallback(async () => {
    setError('');
    setRefreshing(true);
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
    } finally {
      setRefreshing(false);
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

  const filteredAgents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return agents.filter((agent) => {
      const matchesSource =
        sourceFilter === 'all' ||
        (sourceFilter === 'external' ? Boolean(agent.endpoint) : !agent.endpoint);
      if (!matchesSource) return false;
      if (!normalizedQuery) return true;
      return [agent.name, agent.agent_id, agent.description, ...(agent.capabilities || [])]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [agents, query, sourceFilter]);

  useEffect(() => {
    setSelectedId((current) => {
      if (filteredAgents.some((agent) => agent.agent_id === current)) return current;
      return filteredAgents[0]?.agent_id || '';
    });
  }, [filteredAgents]);

  useEffect(() => {
    setEgressConfirmed(false);
    setResult(null);
    setRawResultOpen(false);
    setNotice('');
  }, [selectedId]);

  const healthyCount = agents.filter((agent) =>
    isAgentHealthy(healthMap.get(agent.agent_id), agent.status),
  ).length;
  const externalCount = agents.filter((agent) => Boolean(agent.endpoint)).length;
  const localCount = agents.length - externalCount;

  const selected = agents.find((a) => a.agent_id === selectedId);
  const selectedHealth = selectedId ? healthMap.get(selectedId) : undefined;
  const selectedMarket = selectedId ? marketMap.get(selectedId) : undefined;
  const isExternal = Boolean(selected?.endpoint);
  const selectedIsHealthy = selected
    ? isAgentHealthy(selectedHealth, selected.status)
    : false;
  const selectedHealthLabel = selected
    ? getHealthLabel(selectedHealth, selected.status)
    : '待检测';
  const selectedCircuit = String(selectedHealth?.circuit_state || 'closed');
  const selectedOutput = typeof result?.output === 'string' ? result.output : '';

  const onInvoke = async () => {
    if (!selectedId) return;
    setBusy(true);
    setError('');
    setNotice('');
    setResult(null);
    setRawResultOpen(false);
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
    <section className="agent-hub-page">
      <header className="agent-hub-heading">
        <div className="agent-hub-heading-copy">
          <span className="agent-hub-kicker">AGENT REGISTRY</span>
          <h1>Agent 市场</h1>
          <p>集中查看已接入 Agent 的可用性、能力边界与连接状态，并完成安全试调。</p>
        </div>
        <button
          type="button"
          className="secondary-action agent-hub-refresh"
          disabled={refreshing}
          onClick={() => void refresh()}
        >
          <RefreshIcon />
          {refreshing ? '刷新中…' : '刷新状态'}
        </button>
      </header>

      <section className="agent-hub-overview" aria-label="Agent 市场概览">
        <div className="agent-hub-stat">
          <span>已注册</span>
          <strong>{agents.length}</strong>
          <small>全部 Agent</small>
        </div>
        <div className="agent-hub-stat">
          <span>运行正常</span>
          <strong>{healthyCount}</strong>
          <small>{healthyCount === agents.length && agents.length ? '状态稳定' : '需关注异常'}</small>
        </div>
        <div className="agent-hub-stat">
          <span>本地</span>
          <strong>{localCount}</strong>
          <small>内网运行</small>
        </div>
        <div className="agent-hub-stat">
          <span>外部</span>
          <strong>{externalCount}</strong>
          <small>需关注出域</small>
        </div>
      </section>

      {error ? (
        <div className="agent-hub-message is-error" role="alert">
          <span aria-hidden="true">!</span>
          <p>{error}</p>
        </div>
      ) : null}
      {notice ? (
        <div className="agent-hub-message is-success" role="status">
          <span aria-hidden="true">✓</span>
          <p>{notice}</p>
        </div>
      ) : null}

      <div className="agent-hub-layout">
        <aside className="agent-hub-directory" aria-label="Agent 目录">
          <header className="agent-hub-directory-heading">
            <div>
              <span className="agent-hub-section-kicker">AGENT DIRECTORY</span>
              <h2>可用 Agent</h2>
            </div>
            <span className="agent-hub-directory-count">{filteredAgents.length} / {agents.length}</span>
          </header>

          <label className="agent-hub-search">
            <span className="sr-only">搜索 Agent</span>
            <SearchIcon />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索名称、ID 或能力"
            />
          </label>

          <div className="agent-hub-filters" role="group" aria-label="Agent 来源筛选">
            <button
              type="button"
              className={sourceFilter === 'all' ? 'is-current' : ''}
              aria-pressed={sourceFilter === 'all'}
              onClick={() => setSourceFilter('all')}
            >
              <span>全部</span>
              <small>{agents.length}</small>
            </button>
            <button
              type="button"
              className={sourceFilter === 'local' ? 'is-current' : ''}
              aria-pressed={sourceFilter === 'local'}
              onClick={() => setSourceFilter('local')}
            >
              <span>本地</span>
              <small>{localCount}</small>
            </button>
            <button
              type="button"
              className={sourceFilter === 'external' ? 'is-current' : ''}
              aria-pressed={sourceFilter === 'external'}
              onClick={() => setSourceFilter('external')}
            >
              <span>外部</span>
              <small>{externalCount}</small>
            </button>
          </div>

          <div className="agent-hub-list">
            {filteredAgents.map((agent) => {
              const agentHealth = healthMap.get(agent.agent_id);
              const agentIsHealthy = isAgentHealthy(agentHealth, agent.status);
              const external = Boolean(agent.endpoint);
              return (
                <button
                  key={agent.agent_id}
                  type="button"
                  className={`agent-hub-list-item ${selectedId === agent.agent_id ? 'is-current' : ''}`}
                  aria-pressed={selectedId === agent.agent_id}
                  onClick={() => setSelectedId(agent.agent_id)}
                >
                  <AgentMark external={external} label={agent.name} />
                  <span className="agent-hub-list-copy">
                    <span className="agent-hub-list-title">
                      <strong>{agent.name}</strong>
                      <small>{external ? '外部' : '本地'}</small>
                    </span>
                    <span className="agent-hub-list-description">{agent.description || '暂无说明'}</span>
                    <span className="agent-hub-list-meta">
                      <code>{agent.agent_id}</code>
                      <span className={agentIsHealthy ? 'is-healthy' : 'is-unhealthy'}>
                        <i aria-hidden="true" />
                        {agentIsHealthy ? '正常' : '异常'}
                      </span>
                      {agentHealth?.dry_run ? <em>DRY RUN</em> : null}
                    </span>
                    {agent.capabilities?.length ? (
                      <span className="agent-hub-list-capabilities" aria-hidden="true">
                        {agent.capabilities.slice(0, 2).map((capability) => (
                          <span key={`${agent.agent_id}-${capability}`}>{capability}</span>
                        ))}
                        {agent.capabilities.length > 2 ? <span>+{agent.capabilities.length - 2}</span> : null}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}

            {!filteredAgents.length ? (
              <div className="agent-hub-empty">
                <span aria-hidden="true">⌕</span>
                <strong>{agents.length ? '没有匹配的 Agent' : '暂无已注册 Agent'}</strong>
                <p>{agents.length ? '换个关键词或清除来源筛选。' : '完成注册后，Agent 会出现在这里。'}</p>
                {agents.length ? (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('');
                      setSourceFilter('all');
                    }}
                  >
                    清除筛选
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </aside>

        <article className="agent-hub-workbench" aria-label="Agent 工作台">
          {selected ? (
            <>
              <header className="agent-hub-detail-heading">
                <div className="agent-hub-identity">
                  <AgentMark external={isExternal} label={selected.name} />
                  <div>
                    <span className="agent-hub-section-kicker">
                      {isExternal ? 'EXTERNAL AGENT' : 'LOCAL AGENT'}
                    </span>
                    <h2>{selected.name}</h2>
                    <p>{selected.description || '暂无 Agent 说明。'}</p>
                  </div>
                </div>
                <div className="agent-hub-detail-badges">
                  <span className={selectedIsHealthy ? 'is-healthy' : 'is-unhealthy'}>
                    <i aria-hidden="true" />
                    {selectedHealthLabel}
                  </span>
                  <span>v{selected.version || '—'}</span>
                </div>
              </header>

              <section className="agent-hub-section" aria-label="运行状态">
                <div className="agent-hub-section-heading">
                  <div>
                    <span className="agent-hub-section-kicker">HEALTH &amp; CIRCUIT</span>
                    <h3>运行状态</h3>
                  </div>
                  <span className="agent-hub-live-label">
                    <i aria-hidden="true" />
                    实时快照
                  </span>
                </div>

                <dl className="agent-hub-health-grid">
                  <div>
                    <dt>服务状态</dt>
                    <dd className={selectedIsHealthy ? 'is-healthy' : 'is-unhealthy'}>
                      {selectedHealthLabel}
                    </dd>
                  </div>
                  <div>
                    <dt>熔断器</dt>
                    <dd>{CIRCUIT_STATUS_LABELS[selectedCircuit] || selectedCircuit}</dd>
                  </div>
                  <div>
                    <dt>响应延迟</dt>
                    <dd>
                      {selectedHealth?.latency_ms != null
                        ? `${String(selectedHealth.latency_ms)} ms`
                        : '未采集'}
                    </dd>
                  </div>
                  <div>
                    <dt>市场状态</dt>
                    <dd>{getMarketStatusLabel(selectedMarket?.status)}</dd>
                  </div>
                </dl>

                <details className="agent-hub-diagnostics">
                  <summary>查看诊断详情</summary>
                  <dl>
                    <div>
                      <dt>Agent ID</dt>
                      <dd><code>{selected.agent_id}</code></dd>
                    </div>
                    <div>
                      <dt>原始状态</dt>
                      <dd>{String(selectedHealth?.status || selected.status || '—')}</dd>
                    </div>
                    {selectedHealth?.detail ? (
                      <div>
                        <dt>诊断信息</dt>
                        <dd>{String(selectedHealth.detail)}</dd>
                      </div>
                    ) : null}
                    {selectedHealth?.auth_hint ? (
                      <div>
                        <dt>凭证状态</dt>
                        <dd>{String(selectedHealth.auth_hint)}</dd>
                      </div>
                    ) : null}
                  </dl>
                </details>
              </section>

              <section className="agent-hub-section agent-hub-connection" aria-label="能力与连接">
                <div className="agent-hub-section-heading">
                  <div>
                    <span className="agent-hub-section-kicker">CAPABILITY &amp; CONNECTION</span>
                    <h3>能力与连接</h3>
                  </div>
                </div>

                <div className="agent-hub-capabilities">
                  {(selected.capabilities || []).length ? (
                    selected.capabilities.map((capability) => (
                      <span key={`${selected.agent_id}-detail-${capability}`}>{capability}</span>
                    ))
                  ) : (
                    <span className="is-empty">暂未声明能力</span>
                  )}
                </div>

                <dl className="agent-hub-connection-list">
                  <div>
                    <dt>调用方式</dt>
                    <dd>{isExternal ? '外部服务端点' : '本地运行时'}</dd>
                  </div>
                  <div>
                    <dt>连接地址</dt>
                    <dd><code>{selected.endpoint || 'local://runtime'}</code></dd>
                  </div>
                  {selectedMarket?.cost_per_call_micros != null ? (
                    <div>
                      <dt>单次成本</dt>
                      <dd>{String(selectedMarket.cost_per_call_micros)} µ</dd>
                    </div>
                  ) : null}
                </dl>
              </section>

              <section className="agent-hub-testbench" aria-label="试调工作台">
                <div className="agent-hub-section-heading">
                  <div>
                    <span className="agent-hub-section-kicker">TEST CONSOLE</span>
                    <h3>试调工作台</h3>
                  </div>
                  <span className="agent-hub-test-mode">单次调用</span>
                </div>

                <label className="agent-hub-field">
                  <span>试调输入</span>
                  <textarea
                    value={inputText}
                    onChange={(event) => setInputText(event.target.value)}
                    rows={5}
                    placeholder="输入希望 Agent 处理的内容"
                  />
                  <small>本次输入仅用于当前试调，不会修改 Agent 配置。</small>
                </label>

                {isExternal ? (
                  <label className="agent-hub-egress-confirmation">
                    <input
                      type="checkbox"
                      checked={egressConfirmed}
                      onChange={(event) => setEgressConfirmed(event.target.checked)}
                    />
                    <span>
                      <strong>确认出域发送（敏感内容需勾选）</strong>
                      <small>输入内容将发送到第三方 Agent 服务，请先确认数据边界。</small>
                    </span>
                  </label>
                ) : null}

                <div className="agent-hub-test-actions">
                  <button
                    type="button"
                    className="primary-action"
                    disabled={busy || !selectedId}
                    onClick={() => void onInvoke()}
                  >
                    {busy ? '调用中…' : '试调调用'}
                  </button>
                  <span>调用前会再次读取当前 Agent 状态</span>
                </div>

                {result ? (
                  <section className="agent-hub-result" aria-label="调用结果">
                    <header>
                      <span className="agent-hub-result-icon" aria-hidden="true">✓</span>
                      <div>
                        <strong>调用结果</strong>
                        <small>Agent 已返回响应</small>
                      </div>
                    </header>
                    {selectedOutput ? (
                      <p className="agent-hub-result-output">{selectedOutput}</p>
                    ) : (
                      <pre>{JSON.stringify(result, null, 2)}</pre>
                    )}
                    {selectedOutput ? (
                      <details onToggle={(event) => setRawResultOpen(event.currentTarget.open)}>
                        <summary>查看完整响应</summary>
                        {rawResultOpen ? <pre>{JSON.stringify(result, null, 2)}</pre> : null}
                      </details>
                    ) : null}
                  </section>
                ) : null}
              </section>

              {isAdmin ? (
                <section className="agent-hub-market-controls" aria-label="市场管理">
                  <div>
                    <span className="agent-hub-section-kicker">ADMIN CONTROLS</span>
                    <h3>市场管理</h3>
                    <p>当前状态：{getMarketStatusLabel(selectedMarket?.status)}</p>
                  </div>
                  <div className="agent-hub-market-actions">
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
                  </div>
                </section>
              ) : null}
            </>
          ) : (
            <div className="agent-hub-placeholder">
              <span aria-hidden="true">A</span>
              <strong>{agents.length ? '选择一个 Agent' : '等待 Agent 接入'}</strong>
              <p>{agents.length ? '从左侧目录选择 Agent，查看运行状态并开始试调。' : '注册完成后可在此查看与试调。'}</p>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
