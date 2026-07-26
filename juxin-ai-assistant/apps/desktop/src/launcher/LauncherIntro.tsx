import juxinAiWordmark from '../assets/juxin-ai-wordmark.png';

const VALUE_POINTS = [
  {
    icon: 'grid',
    title: '十类私人助理，258项工作技能',
    detail: '你只要说想做什么，我会按岗位场景匹配合适流程。',
  },
  {
    icon: 'shield',
    title: '统一登录，安全接入',
    detail: '统一登录后先选择要进入的系统，再进入工作台；我不会在本机保存账号密码。',
  },
  {
    icon: 'lock',
    title: '你的设置只在本机',
    detail: '个人模型和偏好加密保存，使用时由你自己掌控。',
  },
  {
    icon: 'document',
    title: '草稿我会先替你收好',
    detail: '断网也能保留草稿和待同步内容，恢复后再安全同步。',
  },
] as const;

function FeatureIcon({ type }: { readonly type: (typeof VALUE_POINTS)[number]['icon'] }) {
  if (type === 'grid') {
    return (
      <svg aria-hidden="true" viewBox="0 0 32 32">
        <rect height="9" rx="2.4" width="9" x="6" y="6" />
        <rect height="9" rx="2.4" width="9" x="17" y="6" />
        <rect height="9" rx="2.4" width="9" x="6" y="17" />
        <rect height="9" rx="2.4" width="9" x="17" y="17" />
      </svg>
    );
  }

  if (type === 'shield') {
    return (
      <svg aria-hidden="true" viewBox="0 0 32 32">
        <path d="M16 4 25 7.5v7.3c0 6-3.7 10.7-9 13.2-5.3-2.5-9-7.2-9-13.2V7.5L16 4Z" />
        <circle cx="16" cy="13" r="3.1" fill="white" opacity=".9" />
        <path d="M10.8 22.5c.9-3.1 2.7-4.6 5.2-4.6s4.3 1.5 5.2 4.6" fill="white" opacity=".9" />
      </svg>
    );
  }

  if (type === 'lock') {
    return (
      <svg aria-hidden="true" viewBox="0 0 32 32">
        <path d="M10 14v-3.2C10 7.4 12.7 5 16 5s6 2.4 6 5.8V14h-3v-3.2C19 9.1 17.8 8 16 8s-3 1.1-3 2.8V14h-3Z" />
        <rect height="13" rx="3" width="18" x="7" y="13" />
        <circle cx="16" cy="20" fill="white" r="2" />
        <path d="M15 21.5h2v3h-2z" fill="white" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 32 32">
      <path d="M9 4h10l5 5v19H9V4Z" />
      <path d="M19 4v6h5" fill="white" opacity=".45" />
      <path d="M13 14h8M13 19h6" fill="none" stroke="white" strokeLinecap="round" strokeWidth="2" />
      <circle cx="23" cy="23" fill="white" r="5" />
      <path d="m20.8 23 1.5 1.6 3-3.3" fill="none" stroke="#2563eb" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

export function LauncherIntro() {
  return (
    <section className="launcher-intro" aria-labelledby="launcher-title">
      <div className="launcher-brand">
        <img alt="聚信AI助手" src={juxinAiWordmark} />
      </div>
      <div className="launcher-hero-panel">
        <div className="launcher-hero-copy">
          <span className="launcher-hero-badge">
            <span aria-hidden="true">✦</span>
            你的私人助理
          </span>
          <h1 id="launcher-title">你的私人助理</h1>
          <span className="launcher-title-rule" aria-hidden="true" />
          <p>
            写材料、查资料、整理文档、生成报告，一句话交给聚信 AI 助手。
          </p>
        </div>
        <div className="launcher-ai-visual" aria-hidden="true">
          <div className="launcher-ai-card">AI</div>
          <span className="launcher-ai-dot is-one" />
          <span className="launcher-ai-dot is-two" />
        </div>
      </div>
      <div className="launcher-values" aria-label="聚信 AI 助手核心能力">
        {VALUE_POINTS.map((point, index) => (
          <article key={point.title}>
            <div className="launcher-feature-icon">
              <FeatureIcon type={point.icon} />
            </div>
            <div>
              <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <h2>{point.title}</h2>
              <p>{point.detail}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
