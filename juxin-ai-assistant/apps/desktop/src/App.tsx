import { useEffect, useState } from 'react';

import { ApiError, getAuthPortalUrl, getSession, getTask, type SessionPayload } from './api/client';
import { ModelProfilesPage } from './pages/ModelProfilesPage';
import { TaskRunPage, type TaskDefinition } from './pages/TaskRunPage';

type ViewState =
  | { kind: 'checking' }
  | { kind: 'ready'; session: SessionPayload }
  | { kind: 'forbidden' }
  | { kind: 'error' };

const assistantGroups = [
  ['工作总结', '总结、润色与日常表达'],
  ['销售助手', '客户沟通与商机推进'],
  ['产品交付', '方案、计划与复盘'],
  ['商务投标', '标书分析与响应材料'],
];

function Workspace({ session }: { session: SessionPayload }) {
  const [page, setPage] = useState<'home' | 'task' | 'models'>('home');
  const [task, setTask] = useState<TaskDefinition | null>(null);
  const [taskError, setTaskError] = useState('');

  const openWorkSummary = () => {
    setTaskError('');
    setPage('task');
    getTask('work-summary')
      .then(setTask)
      .catch(() => setTaskError('工作总结任务尚未发布或服务暂不可用'));
  };

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="brand-mark" aria-label="聚信 AI 助手">
          <span>聚</span>
          <strong>聚信 AI 助手</strong>
        </div>
        <nav aria-label="主导航">
          <button className={page === 'home' ? 'is-current' : ''} onClick={() => setPage('home')} type="button">工作台</button>
          <button className={page === 'task' ? 'is-current' : ''} onClick={openWorkSummary} type="button">全部助手</button>
          <button type="button">历史记录</button>
          <button className={page === 'models' ? 'is-current' : ''} onClick={() => setPage('models')} type="button">个人模型</button>
        </nav>
        <div className="sidebar-foot">
          <span className="presence-dot" />
          <div>
            <strong>{session.user.username}</strong>
            <small>{session.scope.department || '聚信员工'}</small>
          </div>
        </div>
      </aside>

      <main className="workspace" id="workspace">
        {page === 'models' ? (
          <ModelProfilesPage />
        ) : page === 'task' ? (
          <>
            <button className="back-button" onClick={() => setPage('home')} type="button">‹ 返回工作台</button>
            {task
              ? <TaskRunPage task={task} />
              : <section className="desktop-required"><p>{taskError || '正在加载任务…'}</p></section>}
          </>
        ) : (
          <>
            <header className="topbar">
              <div>
                <span className="eyebrow">企业智能工作台</span>
                <h1>上午好，{session.user.username}</h1>
              </div>
              <label className="search-field">
                <span>⌕</span>
                <input aria-label="搜索助手或任务" placeholder="搜索助手或任务" />
                <kbd>⌘ K</kbd>
              </label>
            </header>

            <section className="hero-panel">
              <div>
                <span className="hero-kicker">从任务开始，不必从 Prompt 开始</span>
                <h2>今天想完成什么？</h2>
                <p>选择一个具体任务，聚信会准备好结构、提示词与输出要求。</p>
              </div>
              <button onClick={openWorkSummary} type="button">开始工作总结 <span>→</span></button>
            </section>

            <section className="section-block" id="assistants">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">快捷入口</span>
                  <h2>常用助手</h2>
                </div>
                <button className="link-button" onClick={openWorkSummary} type="button">查看全部</button>
              </div>
              <div className="assistant-grid">
                {assistantGroups.map(([name, description], index) => (
                  <button
                    className="assistant-row"
                    key={name}
                    onClick={() => index === 0 && openWorkSummary()}
                    type="button"
                  >
                    <span className={`assistant-glyph tone-${index + 1}`}>{name.slice(0, 1)}</span>
                    <span>
                      <strong>{name}</strong>
                      <small>{description}</small>
                    </span>
                    <span className="row-arrow">›</span>
                  </button>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function StatusView({ kind }: { kind: 'checking' | 'forbidden' | 'error' }) {
  if (kind === 'checking') {
    return (
      <main className="status-view">
        <span className="status-orb" />
        <p>正在检查统一登录…</p>
      </main>
    );
  }

  const forbidden = kind === 'forbidden';
  return (
    <main className="status-view">
      <span className="status-symbol">{forbidden ? '!' : '↻'}</span>
      <h1>{forbidden ? '暂时无法进入工作台' : '服务暂时不可用'}</h1>
      <p>
        {forbidden
          ? '你的统一账号尚未获得聚信 AI 助手访问权限。'
          : '无法连接聚信 AI 助手服务，请稍后再试。'}
      </p>
      <a href={getAuthPortalUrl()}>
        返回统一门户
      </a>
    </main>
  );
}

export default function App() {
  const [state, setState] = useState<ViewState>({ kind: 'checking' });

  useEffect(() => {
    let active = true;
    getSession()
      .then((session) => {
        if (active) setState({ kind: 'ready', session });
      })
      .catch((error: unknown) => {
        if (!active || (error instanceof ApiError && error.status === 401)) return;
        setState({
          kind: error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error',
        });
      });
    return () => {
      active = false;
    };
  }, []);

  return state.kind === 'ready'
    ? <Workspace session={state.session} />
    : <StatusView kind={state.kind} />;
}
