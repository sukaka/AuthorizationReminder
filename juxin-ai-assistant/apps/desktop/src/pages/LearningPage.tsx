import { useEffect, useMemo, useState } from 'react';

import {
  approveLearningTemplateReview,
  createLearningMemory,
  deleteLearningExperience,
  deleteLearningFailureCase,
  deleteLearningMemory,
  deleteLearningTemplate,
  listLearningExperiences,
  listLearningFailureCases,
  listLearningFeedback,
  listLearningMemories,
  listLearningTemplateReviews,
  listLearningTemplates,
  listLearningCandidates,
  rejectLearningTemplateReview,
  submitLearningTemplateReview,
  transitionLearningCandidate,
  updateLearningExperience,
  updateLearningFailureCase,
  updateLearningMemory,
  updateLearningTemplate,
  type LearningCandidatePayload,
  type LearningExperiencePayload,
  type LearningFailureCasePayload,
  type LearningFeedbackPayload,
  type LearningMemoryPayload,
  type LearningTemplatePayload,
} from '../api/client';
import { confirmAppDialog, promptAppDialog } from '../components/appDialog';

type LearningTab = 'knowledge' | 'templates' | 'template-reviews' | 'improvements' | 'candidates';

const MEMORY_TYPE_OPTIONS = [
  ['user_preference', '用户偏好'],
  ['document_format', '文档格式'],
  ['correction', '纠错规则'],
  ['forbidden_style', '禁用表达'],
  ['role_rule', '岗位规则'],
  ['template', '模板'],
  ['experience', '经验'],
  ['failure_case', '失败案例'],
] as const;

const PRIORITY_LABEL: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

const FEEDBACK_LABEL: Record<string, string> = {
  useful: '有用',
  not_useful: '没用',
  needs_revision: '需要修改',
  save_experience: '保存为经验',
  save_template: '保存为模板',
  record_error: '记录为错误',
};

const SAVED_AS_LABEL: Record<string, string> = {
  experience: '经验',
  template: '模板',
  failure_case: '错误修正',
  memory: '记忆',
};

function tagText(tags: string[]): string {
  return tags.length ? tags.join('、') : '未设置标签';
}

function splitTags(value: string): string[] {
  return value.split(/[,，、\s]+/).map((tag) => tag.trim()).filter(Boolean);
}

export function LearningPage({ isAdmin = false }: { isAdmin?: boolean }) {
  const [tab, setTab] = useState<LearningTab>('knowledge');
  const [memories, setMemories] = useState<LearningMemoryPayload[]>([]);
  const [experiences, setExperiences] = useState<LearningExperiencePayload[]>([]);
  const [templates, setTemplates] = useState<LearningTemplatePayload[]>([]);
  const [templateReviews, setTemplateReviews] = useState<LearningTemplatePayload[]>([]);
  const [failures, setFailures] = useState<LearningFailureCasePayload[]>([]);
  const [feedbackLogs, setFeedbackLogs] = useState<LearningFeedbackPayload[]>([]);
  const [candidates, setCandidates] = useState<LearningCandidatePayload[]>([]);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState({
    memory_type: 'user_preference',
    title: '',
    content: '',
    priority: 'medium' as 'high' | 'medium' | 'low',
    tags: '',
  });

  const memoryCount = useMemo(
    () => memories.filter((item) => item.status === 'active').length,
    [memories],
  );

  const refresh = async () => {
    setLoading(true);
    setNotice('');
    try {
      const [
        memoryPayload,
        experiencePayload,
        templatePayload,
        failurePayload,
        feedbackPayload,
        templateReviewPayload,
        candidatePayload,
      ] = await Promise.all([
        listLearningMemories('all'),
        listLearningExperiences(),
        listLearningTemplates(),
        listLearningFailureCases(),
        listLearningFeedback(),
        isAdmin ? listLearningTemplateReviews() : Promise.resolve({ items: [], total: 0 }),
        listLearningCandidates().catch(() => ({ items: [], total: 0 })),
      ]);
      setMemories(memoryPayload.items);
      setExperiences(experiencePayload.items);
      setTemplates(templatePayload.items);
      setFailures(failurePayload.items);
      setFeedbackLogs(feedbackPayload.items);
      setTemplateReviews(templateReviewPayload.items);
      setCandidates(candidatePayload.items || []);
    } catch {
      setNotice('学习中心加载失败，请稍后重试。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const saveMemory = async () => {
    if (!draft.content.trim()) {
      setNotice('请先填写要记住的内容。');
      return;
    }
    try {
      await createLearningMemory({
        memory_type: draft.memory_type,
        title: draft.title.trim(),
        content: draft.content.trim(),
        priority: draft.priority,
        tags: splitTags(draft.tags),
      });
      setDraft({
        memory_type: 'user_preference',
        title: '',
        content: '',
        priority: 'medium',
        tags: '',
      });
      setNotice('已保存为长期记忆。');
      await refresh();
    } catch {
      setNotice('保存失败，请稍后重试。');
    }
  };

  const toggleMemory = async (item: LearningMemoryPayload) => {
    try {
      await updateLearningMemory(item.uuid, { status: item.status === 'active' ? 'disabled' : 'active' });
      await refresh();
    } catch {
      setNotice('状态更新失败。');
    }
  };

  const editMemory = async (item: LearningMemoryPayload) => {
    const title = (await promptAppDialog({
      title: '记忆标题',
      initialValue: item.title || item.memory_type,
    }))?.trim();
    if (!title) return;
    const content = (await promptAppDialog({
      title: '记忆内容',
      initialValue: item.content,
      multiline: true,
    }))?.trim();
    if (!content) return;
    try {
      await updateLearningMemory(item.uuid, { title, content });
      setNotice('记忆已更新。');
      await refresh();
    } catch {
      setNotice('记忆更新失败。');
    }
  };

  const removeMemory = async (item: LearningMemoryPayload) => {
    if (!(await confirmAppDialog({
      title: '删除记忆',
      message: '删除后，这条记忆不会再参与回答。',
      confirmLabel: '确认删除',
      danger: true,
    }))) return;
    try {
      await deleteLearningMemory(item.uuid);
      await refresh();
    } catch {
      setNotice('删除失败，请稍后重试。');
    }
  };

  const editExperience = async (item: LearningExperiencePayload) => {
    const title = (await promptAppDialog({
      title: '经验标题',
      initialValue: item.title,
    }))?.trim();
    if (!title) return;
    const summary = (await promptAppDialog({
      title: '经验摘要',
      initialValue: item.summary || item.answer.slice(0, 300),
      multiline: true,
    }))?.trim();
    if (summary === undefined) return;
    try {
      await updateLearningExperience(item.uuid, { title, summary });
      setNotice('经验已更新。');
      await refresh();
    } catch {
      setNotice('经验更新失败。');
    }
  };

  const removeExperience = async (item: LearningExperiencePayload) => {
    if (!(await confirmAppDialog({
      title: '删除经验',
      message: '删除后，这条经验不会再参与类似问题参考。',
      confirmLabel: '确认删除',
      danger: true,
    }))) return;
    try {
      await deleteLearningExperience(item.uuid);
      setNotice('经验已删除。');
      await refresh();
    } catch {
      setNotice('经验删除失败。');
    }
  };

  const editTemplate = async (item: LearningTemplatePayload) => {
    const templateName = (await promptAppDialog({
      title: '模板名称',
      initialValue: item.template_name,
    }))?.trim();
    if (!templateName) return;
    const templateContent = (await promptAppDialog({
      title: '模板内容',
      initialValue: item.template_content,
      multiline: true,
    }))?.trim();
    if (!templateContent) return;
    try {
      await updateLearningTemplate(item.uuid, { template_name: templateName, template_content: templateContent });
      setNotice('模板已更新。');
      await refresh();
    } catch {
      setNotice('模板更新失败。');
    }
  };

  const submitTemplate = async (item: LearningTemplatePayload) => {
    if (!(await confirmAppDialog({
      title: '提交公司模板审核',
      message: '提交后将作为公司模板候选，等待管理员审核。',
      confirmLabel: '提交审核',
    }))) return;
    try {
      await submitLearningTemplateReview(item.uuid);
      setNotice('已提交公司模板审核。');
      await refresh();
    } catch {
      setNotice('提交审核失败。');
    }
  };

  const removeTemplate = async (item: LearningTemplatePayload) => {
    if (!(await confirmAppDialog({
      title: '删除模板',
      message: `确认删除“${item.template_name}”吗？`,
      confirmLabel: '确认删除',
      danger: true,
    }))) return;
    try {
      await deleteLearningTemplate(item.uuid);
      setNotice('模板已删除。');
      await refresh();
    } catch {
      setNotice('模板删除失败。');
    }
  };

  const approveTemplate = async (item: LearningTemplatePayload) => {
    try {
      await approveLearningTemplateReview(item.uuid);
      setNotice('公司模板已通过。');
      await refresh();
    } catch {
      setNotice('模板审核通过失败。');
    }
  };

  const rejectTemplate = async (item: LearningTemplatePayload) => {
    if (!(await confirmAppDialog({
      title: '驳回公司模板申请',
      message: '驳回后仍会保留为用户个人模板。',
      confirmLabel: '确认驳回',
      danger: true,
    }))) return;
    try {
      await rejectLearningTemplateReview(item.uuid);
      setNotice('公司模板申请已驳回。');
      await refresh();
    } catch {
      setNotice('模板驳回失败。');
    }
  };

  const editFailure = async (item: LearningFailureCasePayload) => {
    const preventionRule = (await promptAppDialog({
      title: '防复发规则',
      initialValue: item.prevention_rule,
      multiline: true,
    }))?.trim();
    if (!preventionRule) return;
    try {
      await updateLearningFailureCase(item.uuid, { prevention_rule: preventionRule });
      setNotice('错误修正记录已更新。');
      await refresh();
    } catch {
      setNotice('错误修正记录更新失败。');
    }
  };

  const removeFailure = async (item: LearningFailureCasePayload) => {
    if (!(await confirmAppDialog({
      title: '删除错误修正记录',
      message: '删除后，这条记录不会再参与防复发提醒。',
      confirmLabel: '确认删除',
      danger: true,
    }))) return;
    try {
      await deleteLearningFailureCase(item.uuid);
      setNotice('错误修正记录已删除。');
      await refresh();
    } catch {
      setNotice('错误修正记录删除失败。');
    }
  };

  return (
    <section className="learning-page">
      <div className="topbar">
        <div>
          <span className="eyebrow">Learning Loop</span>
          <h1>学习中心</h1>
          <p>管理你的长期记忆、经验、模板和错误修正，让小聚越用越懂你。</p>
        </div>
        <button className="secondary-action" disabled={loading} onClick={() => void refresh()} type="button">
          {loading ? '刷新中…' : '刷新'}
        </button>
      </div>

      <div className="learning-summary-grid" aria-label="学习闭环概览">
        <article><strong>{memoryCount + experiences.length}</strong><span>知识沉淀 · {memoryCount} 记忆 / {experiences.length} 经验</span></article>
        <article><strong>{templates.length}</strong><span>我的模板</span></article>
        {isAdmin ? <article><strong>{templateReviews.length}</strong><span>待审模板</span></article> : null}
        <article><strong>{failures.length + feedbackLogs.length}</strong><span>改进记录 · {failures.length} 修正 / {feedbackLogs.length} 反馈</span></article>
        <article><strong>{candidates.length}</strong><span>学习候选</span></article>
      </div>

      <div className="learning-tabs" role="tablist" aria-label="学习中心分类">
        <button className={tab === 'knowledge' ? 'is-active' : ''} onClick={() => setTab('knowledge')} type="button">我的知识</button>
        <button className={tab === 'templates' ? 'is-active' : ''} onClick={() => setTab('templates')} type="button">我的模板</button>
        {isAdmin ? <button className={tab === 'template-reviews' ? 'is-active' : ''} onClick={() => setTab('template-reviews')} type="button">模板审核</button> : null}
        <button className={tab === 'improvements' ? 'is-active' : ''} onClick={() => setTab('improvements')} type="button">改进记录</button>
        <button className={tab === 'candidates' ? 'is-active' : ''} onClick={() => setTab('candidates')} type="button">学习候选</button>
      </div>

      {notice ? <p className="learning-notice">{notice}</p> : null}

      {tab === 'knowledge' ? (
        <div className="learning-section-stack">
          <div className="learning-section-heading">
            <div><span>长期规则</span><h2>记忆与偏好</h2></div>
            <small>{memoryCount} 条启用</small>
          </div>
          <div className="learning-grid">
          <form className="learning-card learning-form" onSubmit={(event) => { event.preventDefault(); void saveMemory(); }}>
            <h2>新增长期记忆</h2>
            <label>
              类型
              <select value={draft.memory_type} onChange={(event) => setDraft((value) => ({ ...value, memory_type: event.target.value }))}>
                {MEMORY_TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              标题
              <input value={draft.title} onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} placeholder="例如：Word 导出提示规则" />
            </label>
            <label>
              内容
              <textarea value={draft.content} onChange={(event) => setDraft((value) => ({ ...value, content: event.target.value }))} placeholder="例如：导出成功只用 Toast，不写入历史会话。" />
            </label>
            <label>
              优先级
              <select value={draft.priority} onChange={(event) => setDraft((value) => ({ ...value, priority: event.target.value as 'high' | 'medium' | 'low' }))}>
                <option value="high">高：纠错/公司规则/岗位边界</option>
                <option value="medium">中：常用偏好/格式习惯</option>
                <option value="low">低：临时偏好</option>
              </select>
            </label>
            <label>
              标签
              <input value={draft.tags} onChange={(event) => setDraft((value) => ({ ...value, tags: event.target.value }))} placeholder="多个标签用逗号分隔" />
            </label>
            <button className="primary-action" type="submit">保存记忆</button>
          </form>

          <div className="learning-list">
            {memories.map((item) => (
              <article className={`learning-card ${item.status === 'disabled' ? 'is-muted' : ''}`} key={item.uuid}>
                <div>
                  <span className={`learning-badge priority-${item.priority}`}>优先级 {PRIORITY_LABEL[item.priority] || item.priority}</span>
                  <span className="learning-badge">{item.status === 'active' ? '启用' : '停用'}</span>
                </div>
                <h2>{item.title || item.memory_type}</h2>
                <p>{item.content}</p>
                <small>{tagText(item.tags)}</small>
                <div className="learning-actions">
                  <button onClick={() => void editMemory(item)} type="button">编辑</button>
                  <button onClick={() => void toggleMemory(item)} type="button">{item.status === 'active' ? '停用' : '启用'}</button>
                  <button className="danger-action" onClick={() => void removeMemory(item)} type="button">删除</button>
                </div>
              </article>
            ))}
            {!memories.length ? <p className="learning-empty">还没有长期记忆。用户确认后保存的偏好、纠错和规则会出现在这里。</p> : null}
          </div>
          </div>
          <div className="learning-section-heading">
            <div><span>复用成果</span><h2>经验沉淀</h2></div>
            <small>{experiences.length} 条经验</small>
          </div>
          <div className="learning-list">
            {experiences.map((item) => (
              <article className="learning-card" key={item.uuid}>
                <span className="learning-badge">{item.task_type || '通用'}</span>
                <h2>{item.title || item.summary || '经验'}</h2>
                <p>{item.summary || item.answer}</p>
                <small>{tagText(item.tags)}</small>
                <div className="learning-actions">
                  <button onClick={() => void editExperience(item)} type="button">编辑</button>
                  <button className="danger-action" onClick={() => void removeExperience(item)} type="button">删除</button>
                </div>
              </article>
            ))}
            {!experiences.length ? <p className="learning-empty">暂无经验。回答下方点击“保存为经验”后会沉淀到这里。</p> : null}
          </div>
        </div>
      ) : null}

      {tab === 'templates' ? (
        <div className="learning-list">
          {templates.map((item) => (
            <article className="learning-card" key={item.uuid}>
              <span className="learning-badge">{item.scope === 'company' ? `公司模板 · ${item.review_status}` : '个人模板'}</span>
              <h2>{item.template_name}</h2>
              <p>{item.template_content}</p>
              <small>{item.task_type || '通用任务'}</small>
              <div className="learning-actions">
                <button onClick={() => void editTemplate(item)} type="button">编辑</button>
                {item.scope === 'personal' ? (
                  <button onClick={() => void submitTemplate(item)} type="button">提交公司模板审核</button>
                ) : null}
                <button className="danger-action" onClick={() => void removeTemplate(item)} type="button">删除</button>
              </div>
            </article>
          ))}
          {!templates.length ? <p className="learning-empty">暂无模板。高频报告结构、提示词结构和文档格式可以保存到这里。</p> : null}
        </div>
      ) : null}

      {isAdmin && tab === 'template-reviews' ? (
        <div className="learning-list">
          {templateReviews.map((item) => (
            <article className="learning-card" key={item.uuid}>
              <span className="learning-badge">公司模板待审核</span>
              <h2>{item.template_name}</h2>
              <p>{item.template_content}</p>
              <small>{item.task_type || '通用任务'}</small>
              <div className="learning-actions">
                <button onClick={() => void approveTemplate(item)} type="button">通过</button>
                <button className="danger-action" onClick={() => void rejectTemplate(item)} type="button">驳回</button>
              </div>
            </article>
          ))}
          {!templateReviews.length ? <p className="learning-empty">暂无待审核公司模板。</p> : null}
        </div>
      ) : null}

      {tab === 'improvements' ? (
        <div className="learning-section-stack">
          <div className="learning-section-heading">
            <div><span>防止复发</span><h2>错误修正</h2></div>
            <small>{failures.length} 条规则</small>
          </div>
          <div className="learning-list">
          {failures.map((item) => (
            <article className="learning-card" key={item.uuid}>
              <span className="learning-badge">{item.task_type || '通用'}</span>
              <h2>防复发规则</h2>
              <p><strong>错误：</strong>{item.wrong_answer}</p>
              <p><strong>修正：</strong>{item.correction}</p>
              <p><strong>以后避免：</strong>{item.prevention_rule}</p>
              <small>{tagText(item.tags)}</small>
              <div className="learning-actions">
                <button onClick={() => void editFailure(item)} type="button">编辑</button>
                <button className="danger-action" onClick={() => void removeFailure(item)} type="button">删除</button>
              </div>
            </article>
          ))}
          {!failures.length ? <p className="learning-empty">暂无错误修正记录。记录过的错误会在类似问题中优先提醒小聚避免复发。</p> : null}
          </div>
          <div className="learning-section-heading">
            <div><span>使用轨迹</span><h2>反馈记录</h2></div>
            <small>{feedbackLogs.length} 条反馈</small>
          </div>
          <div className="learning-list">
            {feedbackLogs.map((item) => (
              <article className="learning-card" key={item.uuid}>
                <div>
                  <span className="learning-badge">{FEEDBACK_LABEL[item.feedback_type] || item.feedback_type}</span>
                  {item.saved_as ? <span className="learning-badge">已沉淀为{SAVED_AS_LABEL[item.saved_as] || item.saved_as}</span> : null}
                </div>
                <h2>{item.comment || FEEDBACK_LABEL[item.feedback_type] || '反馈'}</h2>
                <p>会话：{item.conversation_id || '未绑定'} · 消息：{item.message_id || '未绑定'}</p>
                <small>{new Date(item.created_at).toLocaleString()}</small>
              </article>
            ))}
            {!feedbackLogs.length ? <p className="learning-empty">暂无反馈记录。回答下方点击“有用”“没用”“需要修改”后会出现在这里。</p> : null}
          </div>
        </div>
      ) : null}

      {tab === 'candidates' ? (
        <div className="learning-section-stack">
          <div className="learning-section-heading">
            <div><span>受控成长</span><h2>学习候选</h2></div>
            <small>{candidates.length} 条 · 不会自动发布到生产</small>
          </div>
          <p className="learning-note">
            来自任务反馈的改进草案。管理员可评测后发布；普通用户仅可查看自己的候选。
          </p>
          <div className="learning-list">
            {candidates.map((item) => (
              <article className="learning-card" key={item.candidate_id}>
                <span className="learning-badge">{item.status}</span>
                <span className="learning-badge">{item.candidate_type}</span>
                <h2>{item.title}</h2>
                <p>来源任务：{item.source_run_id ? item.source_run_id.slice(0, 8) : '—'}</p>
                {item.payload ? (
                  <pre className="learning-payload-preview">
                    {JSON.stringify(item.payload, null, 2).slice(0, 600)}
                  </pre>
                ) : null}
                {isAdmin ? (
                  <div className="learning-actions">
                    {item.status === 'draft' ? (
                      <button
                        type="button"
                        onClick={() => {
                          void (async () => {
                            try {
                              await transitionLearningCandidate(item.candidate_id, 'evaluated');
                              setNotice('已标记为已评测');
                              await refresh();
                            } catch {
                              setNotice('状态更新失败');
                            }
                          })();
                        }}
                      >
                        标记已评测
                      </button>
                    ) : null}
                    {item.status === 'evaluated' || item.status === 'staged' ? (
                      <button
                        type="button"
                        onClick={() => {
                          void (async () => {
                            try {
                              await transitionLearningCandidate(item.candidate_id, 'published');
                              setNotice('已发布候选（受控）');
                              await refresh();
                            } catch {
                              setNotice('发布失败（需先评测）');
                            }
                          })();
                        }}
                      >
                        发布
                      </button>
                    ) : null}
                    {item.status === 'published' ? (
                      <button
                        type="button"
                        className="danger-action"
                        onClick={() => {
                          void (async () => {
                            try {
                              await transitionLearningCandidate(item.candidate_id, 'rolled_back');
                              setNotice('已回滚');
                              await refresh();
                            } catch {
                              setNotice('回滚失败');
                            }
                          })();
                        }}
                      >
                        回滚
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))}
            {!candidates.length ? (
              <p className="learning-empty">
                暂无学习候选。在任务中心对结果点「需要改进」后会出现在这里。
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
