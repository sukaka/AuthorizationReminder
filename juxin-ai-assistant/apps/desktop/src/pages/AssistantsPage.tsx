import { useEffect, useMemo, useState } from 'react';

import {
  getCatalog,
  deleteFavorite,
  generateRoleDocument,
  listRoleAssistants,
  putFavorite,
  type AssistantPayload,
  type RoleAssistantPayload,
  type TaskPayload,
} from '../api/client';
import { promptAppDialog } from '../components/appDialog';

type AssistantsPageProps = {
  onOpenTask: (task: TaskPayload) => void;
};

export function AssistantsPage({ onOpenTask }: AssistantsPageProps) {
  const [assistants, setAssistants] = useState<AssistantPayload[]>([]);
  const [roleAssistants, setRoleAssistants] = useState<RoleAssistantPayload[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [roleNotice, setRoleNotice] = useState('');
  const [favoriteTaskUuids, setFavoriteTaskUuids] = useState<Set<string>>(new Set());

  const visibleAssistants = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return assistants;
    return assistants.flatMap((assistant) => {
      const assistantMatches = `${assistant.name} ${assistant.description}`
        .toLocaleLowerCase()
        .includes(normalizedQuery);
      const tasks = assistantMatches
        ? assistant.tasks
        : assistant.tasks.filter((task) =>
            `${task.name} ${task.description}`
              .toLocaleLowerCase()
              .includes(normalizedQuery),
          );
      return tasks.length ? [{ ...assistant, tasks }] : [];
    });
  }, [assistants, query]);

  useEffect(() => {
    let active = true;
    listRoleAssistants()
      .then((payload) => {
        if (active) setRoleAssistants(payload.items || []);
      })
      .catch(() => {
        /* optional band */
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      getCatalog(query)
        .then((payload) => {
          if (active) setAssistants(payload.assistants);
        })
        .catch(() => {
          if (active) setError('助手模式暂时不可用，请稍后重试');
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, query ? 180 : 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const toggleFavorite = async (task: TaskPayload) => {
    const wasFavorite = favoriteTaskUuids.has(task.uuid);
    setFavoriteTaskUuids((current) => {
      const next = new Set(current);
      if (wasFavorite) next.delete(task.uuid);
      else next.add(task.uuid);
      return next;
    });
    try {
      if (wasFavorite) await deleteFavorite(task.uuid);
      else await putFavorite(task.uuid);
    } catch {
      setFavoriteTaskUuids((current) => {
        const next = new Set(current);
        if (wasFavorite) next.add(task.uuid);
        else next.delete(task.uuid);
        return next;
      });
      setError('收藏操作失败，请重试');
    }
  };

  return (
    <section className="catalog-page">
      <header className="catalog-heading">
        <div>
          <span className="eyebrow">按工作选择</span>
          <h1>助手模式</h1>
          <p>选择适合当前工作的模式，帮你写材料、查资料、整理文档和生成报告。</p>
        </div>
        <label className="search-field catalog-search">
          <span>⌕</span>
          <input
            aria-label="搜索助手模式或任务"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索助手模式或任务"
            value={query}
          />
        </label>
      </header>

      {error ? <p className="form-error" role="alert">{error}</p> : null}

      {roleAssistants.length ? (
        <section aria-label="岗位助手" className="catalog-role-section">
          <h2 className="catalog-role-heading">岗位助手</h2>
          {roleNotice ? <p className="form-success">{roleNotice}</p> : null}
          <div className="catalog-role-grid">
            {roleAssistants.map((role) => (
              <article key={role.code} className="catalog-role-card">
                <strong>{role.name}</strong>
                <p className="catalog-role-description">{role.description}</p>
                <small className="catalog-role-meta">
                  模板 {role.templates.length} · 模式 {role.modes.join(' / ')}
                </small>
                <div className="catalog-role-actions">
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={() => {
                      void (async () => {
                        setRoleNotice('');
                        try {
                          const topicInput = await promptAppDialog({
                            title: `为“${role.name}”输入主题`,
                            message: '输入本次要生成的文档主题。',
                            confirmLabel: '开始生成',
                          });
                          if (topicInput === null) return;
                          const topic = topicInput.trim() || role.name;
                          const result = await generateRoleDocument(role.code, {
                            topic,
                            template_code: role.templates[0] || '',
                            create_artifact: true,
                          });
                          setRoleNotice(
                            result.artifact_id
                              ? `已生成草稿并写入任务成果：${result.title}`
                              : `已生成草稿：${result.title}`,
                          );
                        } catch {
                          setRoleNotice('生成失败，请稍后重试');
                        }
                      })();
                    }}
                  >
                    一键套模板
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {loading && assistants.length === 0 ? <p className="catalog-state">正在加载助手…</p> : null}
      {!loading && visibleAssistants.length === 0 && !error ? (
        <div className="catalog-empty">
          <strong>没有找到匹配任务</strong>
          <span>换一个更短的关键词试试。</span>
        </div>
      ) : null}

      <div className="catalog-list">
        {visibleAssistants.map((assistant, assistantIndex) => (
          <article className="catalog-assistant" key={assistant.uuid}>
            <div className="catalog-assistant-intro">
              <span className={`assistant-glyph tone-${(assistantIndex % 4) + 1}`}>
                {assistant.name.slice(0, 1)}
              </span>
              <div>
                <h2>{assistant.name}</h2>
                <p>{assistant.description}</p>
              </div>
            </div>
            <div className="catalog-tasks">
              {assistant.tasks.map((task) => (
                <div className="catalog-task-row" key={task.uuid}>
                  <button className="catalog-task-main" onClick={() => onOpenTask(task)} type="button">
                    <span>
                      <strong>{task.name}</strong>
                      <small>{task.description}</small>
                    </span>
                    <span aria-hidden="true">→</span>
                  </button>
                  <button
                    aria-label={`${favoriteTaskUuids.has(task.uuid) ? '取消收藏' : '收藏'} ${task.name}`}
                    className={`catalog-favorite ${favoriteTaskUuids.has(task.uuid) ? 'is-active' : ''}`}
                    onClick={() => toggleFavorite(task)}
                    type="button"
                  >
                    {favoriteTaskUuids.has(task.uuid) ? '★' : '☆'}
                  </button>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
