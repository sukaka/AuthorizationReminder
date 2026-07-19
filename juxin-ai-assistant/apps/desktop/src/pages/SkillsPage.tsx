import { useEffect, useState } from 'react';

import {
  disableMySkill,
  downloadSkillArtifact,
  listSkillRuns,
  listMySkills,
  listSkills,
  runSkill,
  uploadPersonalSkill,
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
  const [mySkills, setMySkills] = useState<SkillPayload[]>([]);
  const [runs, setRuns] = useState<Array<Record<string, unknown>>>([]);
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState<SkillRunPayload | null>(null);
  const [uploading, setUploading] = useState(false);
  const [question, setQuestion] = useState('');
  const [downloading, setDownloading] = useState('');

  useEffect(() => {
    let alive = true;
    Promise.all([
      listSkills(),
      listMySkills().catch(() => ({ items: [], total: 0 })),
      listSkillRuns(),
    ])
      .then(([skillPayload, minePayload, runPayload]) => {
        if (!alive) return;
        setSkills(skillPayload.items);
        setMySkills(minePayload.items);
        setRuns(runPayload.items);
        setNotice(skillPayload.items.length || minePayload.items.length ? '' : '暂无可用能力');
      })
      .catch(() => {
        if (!alive) return;
        setSkills([]);
        setMySkills([]);
        setRuns([]);
        setNotice('暂无可用能力');
      });
    return () => {
      alive = false;
    };
  }, []);

  const start = async (skill: SkillPayload) => {
    if (skill.status !== 'published') {
      setNotice(`“${skill.name}”当前状态为${skill.status}，暂不可使用。`);
      return;
    }
    setNotice(`正在运行：${skill.name}`);
    setResult(null);
    try {
      const payload = await runSkill(skill.id, {
        task_id: `skill-${skill.id}`,
        input: {
          question: question.trim() || `请执行${skill.name}`,
          ...(skill.requires_attachment ? { attachments: defaultAttachment(skill) } : {}),
          ...(skill.id === 'dashi-ppt' ? { options: { output_format: 'pptx' } } : {}),
        },
      });
      setResult(payload);
      setNotice('能力已完成，成果已生成。');
    } catch {
      setNotice('能力运行失败，请稍后重试。');
    }
  };

  const upload = async (file: File) => {
    setUploading(true);
    setNotice('正在校验 Skill 压缩包…');
    try {
      const uploaded = await uploadPersonalSkill(file);
      setMySkills((current) => [uploaded, ...current.filter((item) => item.id !== uploaded.id)]);
      setNotice(`已上传“${uploaded.name}”，现在可以在“我的 Skill”中使用。`);
    } catch {
      setNotice('Skill 上传失败：请上传包含完整目录结构的 ZIP 压缩包。');
    } finally {
      setUploading(false);
    }
  };

  const disable = async (skill: SkillPayload) => {
    try {
      const updated = await disableMySkill(skill.id);
      setMySkills((current) => current.map((item) => item.id === updated.id ? updated : item));
      setNotice(`已停用“${skill.name}”。`);
    } catch {
      setNotice('停用 Skill 失败，请稍后重试。');
    }
  };

  const renderCard = (skill: SkillPayload, index: number, personal = false) => (
    <article key={skill.id} className="history-card skill-card">
      <div className="skill-card-head">
        <span className="skill-card-icon" aria-hidden="true">{['✦', '✓', '⌁'][index % 3]}</span>
        <span className="knowledge-source-badge">
          {skill.status === 'published' ? '已启用' : skill.status}
        </span>
      </div>
      <div className="skill-card-copy">
        <h2>{skill.name}</h2>
        <p>{skill.description}</p>
      </div>
      <dl className="skill-card-meta">
        <div><dt>输入材料</dt><dd>{materialText(skill)}</dd></div>
        <div>
          <dt>输出格式</dt>
          <dd><span>可生成：</span><span>{skill.output_types.join('、')}</span></dd>
        </div>
      </dl>
      <div className="history-actions">
        <button
          aria-label={`开始使用 ${skill.name}`}
          className="primary-action"
          disabled={skill.status !== 'published'}
          onClick={() => void start(skill)}
          type="button"
        >
          开始使用 <span aria-hidden="true">→</span>
        </button>
        {personal ? (
          <button onClick={() => void disable(skill)} type="button" disabled={skill.status === 'disabled'}>
            停用
          </button>
        ) : null}
      </div>
    </article>
  );

  const commonSkills = skills.filter((skill) => skill.source !== 'uploaded' || skill.scope === 'company');

  return (
    <section className="section-block skills-center" aria-labelledby="skills-heading">
      <div className="section-heading">
        <div>
          <span className="eyebrow">助手能力</span>
          <h1 id="skills-heading">能力中心</h1>
          <p>选择一个业务能力，上传或填写材料后生成可继续修改的工作成果。</p>
          <label>
            需求描述
            <input
              aria-label="能力需求描述"
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="例如：制作一份客户汇报 PPT"
              value={question}
            />
          </label>
        </div>
      </div>
      {notice ? <p role="status">{notice}</p> : null}
      <section className="section-block" aria-labelledby="common-skills-heading">
        <div className="section-heading">
          <div>
            <span className="eyebrow">系统通用</span>
            <h2 id="common-skills-heading">系统通用 Skill</h2>
            <p>由平台维护，所有有权限的用户都可以使用。</p>
          </div>
        </div>
        <div className="task-card-list" aria-label="系统通用 Skill 列表">
          {commonSkills.map((skill, index) => renderCard(skill, index))}
        </div>
      </section>
      <section className="section-block" aria-labelledby="my-skills-heading">
        <div className="section-heading">
          <div>
            <span className="eyebrow">个人能力</span>
            <h2 id="my-skills-heading">我的 Skill</h2>
            <p>仅你自己可见。上传完整 ZIP 包后会立即启用。</p>
          </div>
          <label className="primary-action">
            {uploading ? '上传中…' : '上传我的 Skill'}
            <input
              accept=".zip,application/zip"
              disabled={uploading}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) void upload(file);
              }}
              type="file"
              hidden
            />
          </label>
        </div>
        <div className="task-card-list" aria-label="我的 Skill 列表">
          {mySkills.map((skill, index) => renderCard(skill, index, true))}
          {!mySkills.length ? <p>还没有个人 Skill，上传 ZIP 包后会显示在这里。</p> : null}
        </div>
      </section>
      {result ? (
        <section className="section-block" aria-label="能力运行结果">
          <h2>生成成果</h2>
          <p>{String(result.result.summary || '')}</p>
          <div className="history-list">
            {result.artifacts.map((artifact) => (
              <article className="history-card" key={`${artifact.kind}-${artifact.title}`}>
                <strong>{artifact.title}</strong>
                <span>{artifact.kind}</span>
                {artifact.download_url ? (
                  <button
                    disabled={downloading === artifact.download_url}
                    onClick={() => {
                      const url = artifact.download_url;
                      if (!url) return;
                      setDownloading(url);
                      void downloadSkillArtifact(url, artifact.file_name || artifact.title)
                        .then(() => setNotice(`已下载${artifact.title}`))
                        .catch(() => setNotice('成果下载失败，请稍后重试。'))
                        .finally(() => setDownloading(''));
                    }}
                    type="button"
                  >
                    {downloading === artifact.download_url ? '下载中…' : '下载'}
                  </button>
                ) : null}
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
