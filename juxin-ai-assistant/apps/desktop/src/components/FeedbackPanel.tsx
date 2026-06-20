import { useState } from 'react';

import { submitFeedback, type FeedbackType } from '../api/client';

const feedbackOptions: Array<{ type: FeedbackType; label: string }> = [
  { type: 'USEFUL', label: '有帮助' },
  { type: 'INACCURATE', label: '内容不准确' },
  { type: 'WRONG_FORMAT', label: '格式不合适' },
  { type: 'TOO_VAGUE', label: '内容太空泛' },
  { type: 'NEEDS_EXPERTISE', label: '专业度不足' },
  { type: 'NOT_CLIENT_READY', label: '不适合直接交付' },
  { type: 'OTHER', label: '其他' },
];

type FeedbackPanelProps = {
  generationUuid: string;
  onSubmit?: (type: FeedbackType, content?: string) => Promise<void>;
};

export function FeedbackPanel({ generationUuid, onSubmit }: FeedbackPanelProps) {
  const [selected, setSelected] = useState<FeedbackType | ''>('');
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');

  const send = async () => {
    if (!selected || (selected === 'OTHER' && !content.trim())) return;
    setStatus('sending');
    try {
      if (onSubmit) await onSubmit(selected, content.trim() || undefined);
      else await submitFeedback(generationUuid, selected, content);
      setStatus('done');
    } catch {
      setStatus('error');
    }
  };

  return (
    <section className="feedback-panel" aria-label="结果反馈">
      <h3>这次结果怎么样？</h3>
      <div className="feedback-options">
        {feedbackOptions.map((option) => (
          <label key={option.type}>
            <input
              checked={selected === option.type}
              name={`feedback-${generationUuid}`}
              onChange={() => {
                setSelected(option.type);
                setStatus('idle');
              }}
              type="radio"
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {selected === 'OTHER' ? (
        <label className="feedback-comment">
          <span>补充说明</span>
          <textarea
            aria-label="补充说明"
            maxLength={4000}
            onChange={(event) => setContent(event.target.value)}
            value={content}
          />
        </label>
      ) : null}
      <div className="feedback-actions">
        <button
          className="secondary-action"
          disabled={!selected || status === 'sending' || (selected === 'OTHER' && !content.trim())}
          onClick={send}
          type="button"
        >
          {status === 'sending' ? '提交中…' : '提交反馈'}
        </button>
        {status === 'done' ? <span role="status">感谢反馈</span> : null}
        {status === 'error' ? <span className="form-error" role="alert">反馈提交失败</span> : null}
      </div>
    </section>
  );
}
