import type { ReactNode } from 'react';

const VALUE_POINTS: readonly {
  readonly title: string;
  readonly detail: ReactNode;
}[] = [
  {
    title: '十类助手，258 项常用任务',
    detail: (
      <>
        描述你要完成的工作，助手会
        <span className="launcher-nowrap">自动采用已发布</span>
        的专业提示词。
      </>
    ),
  },
  {
    title: '统一 SSO 安全登录',
    detail: (
      <>
        登录由
        <span className="launcher-nowrap">企业统一身份系统完成</span>
        ，桌面端不保存账号密码。
      </>
    ),
  },
  {
    title: '模型密钥保存在系统钥匙串',
    detail: (
      <>
        个人模型配置
        <span className="launcher-nowrap">留在设备上</span>，
        <span className="launcher-nowrap">业务服务</span>
        不托管你的模型密钥。
      </>
    ),
  },
  {
    title: '草稿与待同步内容保留在本机',
    detail: (
      <>
        网络不可用时仍可
        <span className="launcher-nowrap">进入本地入口</span>
        ，待恢复后再安全同步。
      </>
    ),
  },
];

export function LauncherIntro() {
  return (
    <section className="launcher-intro" aria-labelledby="launcher-title">
      <div className="launcher-brand">
        <span aria-hidden="true">聚</span>
        <div>
          <strong>聚信 AI 助手</strong>
          <small>企业智能工作台</small>
        </div>
      </div>
      <div className="launcher-copy">
        <span className="launcher-eyebrow">无需自己编写提示词</span>
        <h1 id="launcher-title">让日常工作更高效</h1>
        <p>
          告诉智能体你要做什么，
          <span className="launcher-nowrap">聚信 AI 助手</span>
          会从经过治理的任务中匹配流程，帮你生成、整理和复核工作成果。
        </p>
      </div>
      <div className="launcher-values">
        {VALUE_POINTS.map((point, index) => (
          <article key={point.title}>
            <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
            <div>
              <h2>{point.title}</h2>
              <p>{point.detail}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
