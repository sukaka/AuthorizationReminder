import { useEffect, useState } from 'react';

import {
  deleteFavorite,
  getHome,
  getTask,
  routeIntent,
  type HomePayload,
  type IntentCandidatePayload,
  type SessionPayload,
  type TaskPayload,
} from '../api/client';

type HomePageProps = {
  session: SessionPayload;
  onOpenTask: (task: TaskPayload) => void;
  onShowAssistants: () => void;
};

const emptyHome: HomePayload = {
  favorites: [],
  recent_tasks: [],
  recent_generations: [],
  safety_reminders: [],
};

export function HomePage({ session, onOpenTask, onShowAssistants }: HomePageProps) {
  const [home, setHome] = useState<HomePayload>(emptyHome);
  const [error, setError] = useState('');
  const [intentQuery, setIntentQuery] = useState('');
  const [intentCandidates, setIntentCandidates] = useState<IntentCandidatePayload[]>([]);
  const [intentLoading, setIntentLoading] = useState(false);

  useEffect(() => {
    let active = true;
    getHome()
      .then((payload) => {
        if (active) setHome(payload);
      })
      .catch(() => {
        if (active) setError('工作台数据暂时不可用');
      });
    return () => {
      active = false;
    };
  }, []);

  const openTask = async (taskCode: string) => {
    setError('');
    try {
      onOpenTask(await getTask(taskCode));
    } catch {
      setError('任务暂时不可用，请稍后重试');
    }
  };

  const removeFavorite = async (taskUuid: string) => {
    const previous = home.favorites;
    setHome((current) => ({
      ...current,
      favorites: current.favorites.filter((item) => item.task_uuid !== taskUuid),
    }));
    try {
      await deleteFavorite(taskUuid);
    } catch {
      setHome((current) => ({ ...current, favorites: previous }));
      setError('取消收藏失败，请重试');
    }
  };

  const findIntentCandidates = async () => {
    const query = intentQuery.trim();
    if (!query) return;
    setError('');
    setIntentLoading(true);
    try {
      const payload = await routeIntent(query);
      setIntentCandidates(payload.candidates);
      if (!payload.candidates.length) {
        setError('暂时没有匹配到合适任务，可以浏览全部助手。');
      }
    } catch {
      setError('任务匹配暂时不可用，请稍后重试');
    } finally {
      setIntentLoading(false);
    }
  };

  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">企业智能工作台</span>
          <h1>上午好，{session.user.username}</h1>
        </div>
        <button className="secondary-action" onClick={onShowAssistants} type="button">查找助手</button>
      </header>

      <section className="hero-panel">
        <div>
          <span className="hero-kicker">从任务开始，不必自己写提示词</span>
          <h2>今天想完成什么？</h2>
          <p>十类助手已经准备好结构、提示词与输出要求。</p>
          <div className="intent-search">
            <label>
              <span>告诉聚信你想做什么</span>
              <input
                aria-label="告诉聚信你想做什么"
                onChange={(event) => setIntentQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void findIntentCandidates();
                  }
                }}
                placeholder="例如：帮我整理这周工作总结"
                value={intentQuery}
              />
            </label>
            <button
              disabled={intentLoading || !intentQuery.trim()}
              onClick={() => void findIntentCandidates()}
              type="button"
            >
              {intentLoading ? '正在匹配…' : '查找合适任务'}
            </button>
          </div>
        </div>
        <button onClick={onShowAssistants} type="button">浏览全部助手 <span>→</span></button>
      </section>

      {intentCandidates.length ? (
        <section className="section-block">
          <div className="section-heading">
            <div><span className="eyebrow">智能匹配</span><h2>可能适合的任务</h2></div>
          </div>
          <div className="task-card-list compact">
            {intentCandidates.map((candidate) => (
              <article key={candidate.task_uuid}>
                <button className="task-card-main" onClick={() => openTask(candidate.task_code)} type="button">
                  <small>{candidate.assistant_name} · 匹配分 {candidate.score}</small>
                  <strong>{candidate.task_name}</strong>
                  <span>{candidate.reasons.join('、')}</span>
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {error ? <p className="form-error" role="alert">{error}</p> : null}

      <section className="section-block">
        <div className="section-heading">
          <div><span className="eyebrow">固定在这里</span><h2>我的收藏</h2></div>
        </div>
        {home.favorites.length ? (
          <div className="task-card-list">
            {home.favorites.map((item) => (
              <article key={item.task_uuid}>
                <button className="task-card-main" onClick={() => openTask(item.task_code)} type="button">
                  <small>{item.assistant_name}</small>
                  <strong>{item.task_name}</strong>
                  <span>{item.description}</span>
                </button>
                <button
                  aria-label={`取消收藏 ${item.task_name}`}
                  className="task-card-action"
                  onClick={() => removeFavorite(item.task_uuid)}
                  type="button"
                >★</button>
              </article>
            ))}
          </div>
        ) : <p className="empty-hint">收藏常用任务后，它们会出现在这里。</p>}
      </section>

      {home.recent_tasks.length ? (
        <section className="section-block">
          <div className="section-heading"><div><span className="eyebrow">继续处理</span><h2>最近使用</h2></div></div>
          <div className="task-card-list compact">
            {home.recent_tasks.map((item) => (
              <article key={item.task_uuid}>
                <button className="task-card-main" onClick={() => openTask(item.task_code)} type="button">
                  <small>{item.assistant_name}</small><strong>{item.task_name}</strong>
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {home.safety_reminders.length ? (
        <aside className="safety-strip">
          {home.safety_reminders.map((reminder) => <span key={reminder}>{reminder}</span>)}
        </aside>
      ) : null}
    </>
  );
}
