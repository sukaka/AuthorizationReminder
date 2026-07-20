import { useMemo, useState } from 'react';

import './chat-run-prototype.css';

type SideTab = 'plan' | 'activity' | 'sources' | 'files';

type ChatRunPrototypePageProps = {
  readonly onBack?: () => void;
};

type QueuedMessage = {
  id: number;
  text: string;
};

const conversations = [
  { id: 'monthly-report', title: '月度经营分析', meta: '正在执行 · 2 分钟前', tone: 'active' },
  { id: 'risk-review', title: '供应商风险复盘', meta: '已完成 · 今天 09:42', tone: 'done' },
  { id: 'meeting-brief', title: '整理本周会议纪要', meta: '已完成 · 昨天 16:20', tone: 'done' },
  { id: 'customer-plan', title: '客户续约方案初稿', meta: '已暂停 · 周一', tone: 'paused' },
];

const planItems = [
  { label: '理解任务并确定交付格式', detail: '自动路由 → 经营分析助手', status: 'done' },
  { label: '检索经营数据与历史报告', detail: '已找到 12 份相关资料', status: 'done' },
  { label: '生成分析结论与行动建议', detail: '正在整理重点变化', status: 'running' },
  { label: '质量检查并生成可交付文件', detail: '等待上一阶段完成', status: 'pending' },
];

function StatusDot({ status }: { status: string }) {
  return <span className={`crp-status-dot crp-status-dot-${status}`} aria-hidden="true" />;
}

function ActivityIcon({ kind }: { kind: 'route' | 'search' | 'write' | 'review' }) {
  const icons = { route: '↗', search: '⌕', write: '✎', review: '✓' };
  return <span className={`crp-activity-icon crp-activity-icon-${kind}`}>{icons[kind]}</span>;
}

export function ChatRunPrototypePage({ onBack }: ChatRunPrototypePageProps) {
  const [activeConversation, setActiveConversation] = useState('monthly-report');
  const [activeTab, setActiveTab] = useState<SideTab>('plan');
  const [draft, setDraft] = useState('');
  const [isRunning, setIsRunning] = useState(true);
  const [isPlanOpen, setIsPlanOpen] = useState(true);
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([
    { id: 1, text: '补充分析华东区域的异常原因，并给出下周动作建议。' },
  ]);
  const [lastAction, setLastAction] = useState('运行中 · 已自动保存');

  const tabs = useMemo<Array<{ id: SideTab; label: string; count?: string }>>(
    () => [
      { id: 'plan', label: '计划', count: '4' },
      { id: 'activity', label: '活动', count: '6' },
      { id: 'sources', label: '来源', count: '12' },
      { id: 'files', label: '成果', count: '2' },
    ],
    [],
  );

  const submitSteer = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    setLastAction('已补充到当前任务 · Agent 正在调整计划');
    setActiveTab('activity');
  };

  const queueNext = () => {
    const text = draft.trim();
    if (!text) return;
    setQueuedMessages((items) => [...items, { id: Date.now(), text }]);
    setDraft('');
    setLastAction('已排队 · 当前任务完成后自动发送');
  };

  const removeQueued = (id: number) => {
    setQueuedMessages((items) => items.filter((item) => item.id !== id));
    setLastAction('已从队列移除');
  };

  return (
    <section className="chat-run-prototype-page" aria-label="聊天 Run 交互原型">
      <header className="crp-header">
        <div className="crp-header-title">
          {onBack ? <button className="crp-back-button" onClick={onBack} type="button">‹ 返回聊天</button> : null}
          <div>
            <div className="crp-eyebrow">聊天 Run 交互原型 <span>5.0</span></div>
            <h1>让任务过程也成为答案的一部分</h1>
          </div>
        </div>
        <div className="crp-header-actions">
          <span className="crp-prototype-badge"><i /> 本地演示数据</span>
          <button className="crp-quiet-button" type="button">⌘ K 快捷操作</button>
          <button className="crp-primary-button" onClick={() => setIsRunning((running) => !running)} type="button">
            {isRunning ? '停止任务' : '继续运行'}
          </button>
        </div>
      </header>

      <div className="crp-run-strip">
        <div className="crp-run-identity">
          <span className="crp-run-mark">↗</span>
          <div>
            <strong>月度经营分析</strong>
            <span>Run #JX-20260718-0842 · 自动路由至经营分析助手</span>
          </div>
        </div>
        <div className="crp-run-metrics">
          <span><StatusDot status={isRunning ? 'running' : 'paused'} /> {isRunning ? '正在执行' : '已暂停'}</span>
          <span>已运行 02:16</span>
          <span>草稿自动保存</span>
        </div>
      </div>

      <div className="crp-layout">
        <aside className="crp-conversation-panel">
          <div className="crp-panel-heading">
            <div>
              <span className="crp-section-kicker">WORKSPACE</span>
              <h2>任务会话</h2>
            </div>
            <button className="crp-icon-button" aria-label="新建会话" type="button">＋</button>
          </div>
          <div className="crp-search-box"><span>⌕</span><input aria-label="搜索会话" placeholder="搜索任务会话" /></div>
          <div className="crp-conversation-list">
            {conversations.map((conversation) => (
              <button
                className={`crp-conversation-item ${activeConversation === conversation.id ? 'is-active' : ''}`}
                key={conversation.id}
                onClick={() => setActiveConversation(conversation.id)}
                type="button"
              >
                <span className={`crp-conversation-glyph crp-glyph-${conversation.tone}`}><StatusDot status={conversation.tone} /></span>
                <span className="crp-conversation-copy">
                  <strong>{conversation.title}</strong>
                  <small>{conversation.meta}</small>
                </span>
                {conversation.id === activeConversation ? <span className="crp-chevron">›</span> : null}
              </button>
            ))}
          </div>
          <div className="crp-conversation-footer">
            <span>最近 7 天</span>
            <button type="button">查看全部</button>
          </div>
        </aside>

        <main className="crp-chat-column">
          <div className="crp-chat-scroll">
            <div className="crp-message crp-message-user">
              <div className="crp-message-meta"><span>我</span><time>10:26</time></div>
              <div className="crp-user-bubble">请分析 6 月经营数据，重点看收入变化、区域异常和下月行动建议。最终给我一份可以直接汇报的 Word。</div>
              <div className="crp-context-pills"><span>📎 6月经营数据.xlsx</span><span>📎 上月经营分析.docx</span></div>
            </div>

            <div className="crp-message crp-message-assistant">
              <div className="crp-message-meta"><span className="crp-assistant-avatar">聚</span><strong>聚信 AI 助手</strong><span className="crp-auto-route">自动路由</span><time>10:26</time></div>
              <p className="crp-answer-lead">我会先读取本月数据并和上月报告交叉验证，再整理出可以直接用于汇报的结论和行动建议。</p>

              <section className="crp-plan-card">
                <button className="crp-card-title" onClick={() => setIsPlanOpen((open) => !open)} type="button">
                  <span><span className="crp-card-symbol">☷</span><strong>执行计划</strong><small>4 个步骤 · 预计 3 分钟</small></span>
                  <span className="crp-collapse-label">{isPlanOpen ? '收起' : '展开'}⌃</span>
                </button>
                {isPlanOpen ? (
                  <div className="crp-plan-items">
                    {planItems.map((item, index) => (
                      <div className={`crp-plan-item crp-plan-item-${item.status}`} key={item.label}>
                        <span className="crp-plan-index">{item.status === 'done' ? '✓' : String(index + 1).padStart(2, '0')}</span>
                        <span><strong>{item.label}</strong><small>{item.detail}</small></span>
                        <StatusDot status={item.status} />
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className="crp-activity-card">
                <div className="crp-activity-card-head"><div><span className="crp-live-pulse" /> <strong>正在处理</strong><span>实时活动</span></div><button onClick={() => setActiveTab('activity')} type="button">查看全部 ›</button></div>
                <div className="crp-activity-row"><ActivityIcon kind="route" /><div><strong>已完成自动路由</strong><small>经营分析助手 · 置信度 96%</small></div><span className="crp-activity-time">10:26</span></div>
                <div className="crp-activity-row"><ActivityIcon kind="search" /><div><strong>检索企业资料</strong><small>命中 12 份资料 · 已读取 8,420 字</small></div><span className="crp-activity-time">10:27</span></div>
                <div className="crp-activity-row is-current"><ActivityIcon kind="write" /><div><strong>整理收入变化与异常原因</strong><small>正在生成中 <span className="crp-typing-dots">···</span></small></div><span className="crp-activity-time">现在</span></div>
              </section>

              <div className="crp-draft-answer">
                <div className="crp-draft-label"><span className="crp-live-pulse" /> 草稿内容实时更新</div>
                <p>6 月整体收入较上月增长 <mark>8.4%</mark>，主要由华南区域新签客户带动；华东区域收入下降 3.1%，需要进一步核查回款和重点客户流失情况。</p>
              </div>
            </div>
          </div>

          <div className="crp-composer-wrap">
            {queuedMessages.length ? (
              <div className="crp-queue-bar"><span className="crp-queue-label">排队中 <b>{queuedMessages.length}</b></span>{queuedMessages.map((item) => <div className="crp-queue-item" key={item.id}><span>{item.text}</span><button aria-label="移除排队消息" onClick={() => removeQueued(item.id)} type="button">×</button></div>)}</div>
            ) : null}
            <div className="crp-composer">
              <textarea aria-label="补充任务" onChange={(event) => setDraft(event.target.value)} placeholder="补充当前任务，或排队下一条消息…" value={draft} />
              <div className="crp-composer-toolbar">
                <div className="crp-composer-tools"><button aria-label="添加附件" type="button">＋</button><span>自动路由</span><span>当前任务 · JX-0842</span></div>
                <div className="crp-composer-actions"><button className="crp-steer-button" disabled={!draft.trim()} onClick={submitSteer} type="button">补充当前任务</button><button className="crp-queue-button" disabled={!draft.trim()} onClick={queueNext} type="button">排队下一条 ↵</button></div>
              </div>
            </div>
            <div className="crp-composer-hint"><span>{lastAction}</span><span>Enter 换行 · ⌘ Enter 发送</span></div>
          </div>
        </main>

        <aside className="crp-context-panel">
          <div className="crp-context-heading"><div><span className="crp-section-kicker">RUN CONTEXT</span><h2>任务上下文</h2></div><button className="crp-icon-button" aria-label="收起任务上下文" type="button">›</button></div>
          <div className="crp-tabs" role="tablist" aria-label="任务上下文标签">
            {tabs.map((tab) => <button aria-selected={activeTab === tab.id} className={activeTab === tab.id ? 'is-active' : ''} key={tab.id} onClick={() => setActiveTab(tab.id)} role="tab" type="button">{tab.label}<span>{tab.count}</span></button>)}
          </div>
          {activeTab === 'plan' ? (
            <div className="crp-side-content">
              <div className="crp-side-summary"><span className="crp-summary-icon">↗</span><div><strong>自动流程评估报告</strong><small>正在生成 · 预计还需 1 分钟</small></div></div>
              <div className="crp-side-section"><span className="crp-side-label">当前步骤</span><div className="crp-current-step"><StatusDot status="running" /><div><strong>整理收入变化与异常原因</strong><small>经营分析助手</small></div></div></div>
              <div className="crp-side-section"><span className="crp-side-label">交付格式</span><div className="crp-delivery-card"><span className="crp-file-icon">W</span><div><strong>月度经营分析报告.docx</strong><small>完成后可预览、编辑和导出</small></div><span className="crp-file-more">···</span></div><div className="crp-delivery-card"><span className="crp-file-icon crp-file-icon-blue">P</span><div><strong>汇报摘要.pptx</strong><small>将根据最终结论自动生成</small></div><span className="crp-file-more">···</span></div></div>
              <button className="crp-secondary-wide" onClick={() => setLastAction('已打开任务详情（原型）')} type="button">打开任务详情 ↗</button>
            </div>
          ) : activeTab === 'activity' ? (
            <div className="crp-side-content"><div className="crp-side-section"><span className="crp-side-label">最近活动</span><div className="crp-side-activity-list"><div><ActivityIcon kind="write" /><span><strong>生成分析结论</strong><small>运行中 · 18 秒</small></span></div><div><ActivityIcon kind="search" /><span><strong>读取经营数据</strong><small>已完成 · 12 份来源</small></span></div><div><ActivityIcon kind="route" /><span><strong>自动路由</strong><small>已完成 · 96% 置信度</small></span></div><div><ActivityIcon kind="review" /><span><strong>安全检查</strong><small>已完成 · 无风险</small></span></div></div></div><button className="crp-secondary-wide" onClick={() => setLastAction('活动日志已复制')} type="button">复制活动日志</button></div>
          ) : activeTab === 'sources' ? (
            <div className="crp-side-content"><div className="crp-side-section"><span className="crp-side-label">已引用资料</span><div className="crp-source-list"><div><span className="crp-source-type">XLSX</span><span><strong>6月经营数据.xlsx</strong><small>销售数据 · 第 2、4、7 页</small></span></div><div><span className="crp-source-type crp-source-doc">DOCX</span><span><strong>上月经营分析.docx</strong><small>经营报告 · 第 3 页</small></span></div><div><span className="crp-source-type crp-source-pdf">PDF</span><span><strong>区域经营复盘.pdf</strong><small>历史资料 · 第 8 页</small></span></div></div></div><button className="crp-secondary-wide" onClick={() => setLastAction('来源预览已打开')} type="button">查看全部来源 ↗</button></div>
          ) : (
            <div className="crp-side-content"><div className="crp-side-section"><span className="crp-side-label">待交付成果</span><div className="crp-artifact-preview"><div className="crp-artifact-cover"><span>JUXIN INSIGHT</span><strong>从数据到<br />行动建议</strong><small>月度经营分析报告</small></div><div><strong>报告预览</strong><small>内容完成后即可在线编辑</small></div></div></div><button className="crp-secondary-wide" onClick={() => setLastAction('成果预览已打开')} type="button">打开成果预览 ↗</button></div>
          )}
        </aside>
      </div>
    </section>
  );
}
