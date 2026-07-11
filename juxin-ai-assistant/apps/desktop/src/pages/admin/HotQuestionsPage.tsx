import { useEffect, useState } from 'react';

import { governanceApi, type HotQuestionItem } from '../../api/governance';

type PeriodType = 'daily' | 'weekly' | 'monthly';

export function HotQuestionsPage() {
  const [periodType, setPeriodType] = useState<PeriodType>('daily');
  const [items, setItems] = useState<HotQuestionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');

  const load = async (type = periodType) => {
    setLoading(true);
    setNotice('');
    try {
      setItems((await governanceApi.hotQuestions(type)).items);
    } catch {
      setNotice('热点问题报告加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(periodType); }, [periodType]);

  const updateReply = (uuid: string, reply: string) => {
    setItems((current) => current.map((item) => item.uuid === uuid ? { ...item, suggested_reply: reply } : item));
  };

  const review = async (item: HotQuestionItem, status: HotQuestionItem['status']) => {
    try {
      const updated = await governanceApi.reviewHotQuestion(item.uuid, status, item.suggested_reply);
      setItems((current) => current.map((candidate) => candidate.uuid === item.uuid ? updated : candidate));
      setNotice(status === 'approved' ? '专项回复已审核通过' : '专项回复已驳回');
    } catch {
      setNotice('审核操作失败');
    }
  };

  return (
    <section className="admin-page hot-questions-page">
      <header className="catalog-heading">
        <div><span className="eyebrow">问题治理</span><h1>热点问题</h1><p>每天、每周和每月自动汇总前 20 个问题，并生成专项回复草稿。</p></div>
      </header>
      <div className="learning-tabs" role="tablist" aria-label="统计周期">
        {([['daily', '每日'], ['weekly', '每周'], ['monthly', '每月']] as const).map(([value, label]) => (
          <button aria-selected={periodType === value} key={value} onClick={() => setPeriodType(value)} role="tab" type="button">{label}</button>
        ))}
      </div>
      {notice ? <p role="status">{notice}</p> : null}
      {loading ? <p>正在加载热点问题…</p> : null}
      {!loading && !items.length ? <p className="empty-hint">该周期还没有生成报告。</p> : null}
      <div className="hot-question-list">
        {items.map((item) => (
          <article className="history-card" key={item.uuid}>
            <header><strong>#{item.rank} {item.representative_question}</strong><span>{item.question_count} 次</span></header>
            <p>{item.analysis_summary}</p>
            <details><summary>查看相似问法</summary><ul>{item.sample_questions.map((question) => <li key={question}>{question}</li>)}</ul></details>
            <label>专项回复<textarea onChange={(event) => updateReply(item.uuid, event.target.value)} rows={8} value={item.suggested_reply} /></label>
            <div className="history-actions">
              <button onClick={() => void review(item, 'approved')} type="button">审核通过</button>
              <button className="danger-action" onClick={() => void review(item, 'rejected')} type="button">驳回</button>
              <span>{item.status === 'approved' ? '已通过' : item.status === 'rejected' ? '已驳回' : '待审核'}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
