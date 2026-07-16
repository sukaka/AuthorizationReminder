import { useEffect, useState } from 'react';

import {
  listSkillRuns,
  listSkills,
  runSkill,
  type SkillPayload,
  type SkillRunPayload,
} from '../api/client';

function materialText(skill: SkillPayload): string {
  if (!skill.requires_attachment) return '可直接填写说明，也可补充附件';
  return `需要材料：${skill.input_types.join('、')}`;
}

function defaultAttachment(skill: SkillPayload) {
  const fileType = skill.input_types.find((item) => item !== 'text') || 'docx';
  return [{ name: `待处理材料.${fileType}`, file_type: fileType }];
}

export function SkillsPage() {
  const [skills, setSkills] = useState<SkillPayload[]>([]);
  const [runs, setRuns] = useState<Array<Record<string, unknown>>>([]);
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState<SkillRunPayload | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([listSkills(), listSkillRuns()])
      .then(([skillPayload, runPayload]) => {
        if (!alive) return;
        setSkills(skillPayload.items);
        setRuns(runPayload.items);
        setNotice(skillPayload.items.length ? '' : '暂无可用能力');
      })
      .catch(() => {
        if (!alive) return;
        setSkills([]);
        setRuns([]);
        setNotice('暂无可用能力');
      });
    return () => {
      alive = false;
    };
  }, []);

  const start = async (skill: SkillPayload) => {
    setNotice(`正在运行：${skill.name}`);
    setResult(null);
    try {
      const payload = await runSkill(skill.id, {
        task_id: `skill-${skill.id}`,
        input: {
          question: `请执行${skill.name}`,
          attachments: defaultAttachment(skill),
        },
      });
      setResult(payload);
      setNotice('能力已完成，成果已生成。');
    } catch {
      setNotice('能力运行失败，请稍后重试。');
    }
  };

  return (
    <section className="section-block skills-center" aria-labelledby="skills-heading">
      <div className="section-heading">
        <div>
          <span className="eyebrow">助手能力</span>
          <h1 id="skills-heading">能力中心</h1>
          <p>选择一个业务能力，上传或填写材料后生成可继续修改的工作成果。</p>
        </div>
      </div>
      {notice ? <p role="status">{notice}</p> : null}
      <div className="task-card-list" aria-label="助手能力列表">
        {skills.map((skill, index) => (
          <article key={skill.id} className="history-card skill-card">
            <div className="skill-card-head">
              <span className="skill-card-icon" aria-hidden="true">{['✦', '✓', '⌁'][index % 3]}</span>
              <span className="knowledge-source-badge">{skill.status === 'published' ? '已启用' : '未启用'}</span>
            </div>
            <div className="skill-card-copy">
              <h2>{skill.name}</h2>
              <p>{skill.description}</p>
            </div>
            <dl className="skill-card-meta">
              <div><dt>输入材料</dt><dd>{materialText(skill)}</dd></div>
              <div>
                <dt>输出格式</dt>
                <dd>
                  <span>可生成：</span>
                  <span>{skill.output_types.join('、')}</span>
                </dd>
              </div>
            </dl>
            <div className="history-actions">
              <button
                aria-label={`开始使用 ${skill.name}`}
                className="primary-action"
                onClick={() => void start(skill)}
                type="button"
              >
                开始使用 <span aria-hidden="true">→</span>
              </button>
            </div>
          </article>
        ))}
      </div>
      {result ? (
        <section className="section-block" aria-label="能力运行结果">
          <h2>生成成果</h2>
          <p>{String(result.result.summary || '')}</p>
          <div className="history-list">
            {result.artifacts.map((artifact) => (
              <article className="history-card" key={`${artifact.kind}-${artifact.title}`}>
                <strong>{artifact.title}</strong>
                <span>{artifact.kind}</span>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      {runs.length ? (
        <section className="section-block" aria-label="最近运行">
          <h2>最近使用</h2>
          <p>已有 {runs.length} 条能力运行记录。</p>
        </section>
      ) : null}
    </section>
  );
}
