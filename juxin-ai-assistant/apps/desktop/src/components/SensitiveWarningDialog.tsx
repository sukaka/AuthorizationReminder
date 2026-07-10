export type SensitiveFinding = {
  code: string;
  field: string;
  preview: string;
};

function findingLabel(code: string): string {
  if (code === 'PHONE') return '手机号';
  if (code === 'EMAIL') return '邮箱';
  if (code === 'ID_CARD') return '身份证号';
  if (code === 'ACCOUNT_PASSWORD') return '账号或密码';
  return '敏感内容';
}

type SensitiveWarningDialogProps = {
  findings: SensitiveFinding[];
  onCancel: () => void;
  onConfirm: () => void;
};

export function SensitiveWarningDialog({
  findings,
  onCancel,
  onConfirm,
}: SensitiveWarningDialogProps) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby="sensitive-warning-title"
        aria-modal="true"
        className="warning-dialog"
        role="dialog"
      >
        <span className="warning-symbol" aria-hidden="true">!</span>
        <h2 id="sensitive-warning-title">检测到敏感信息</h2>
        <p>检测到 {findings.length} 项敏感信息。确认后仅将本次内容发送给你选择的本地模型。</p>
        <ul>
          {findings.map((finding, index) => (
            <li key={`${finding.code}-${finding.field}-${index}`}>
              <strong>{finding.field || '输入内容'}</strong>
              <span>{findingLabel(finding.code)} · 内容已隐藏</span>
            </li>
          ))}
        </ul>
        <div className="dialog-actions">
          <button className="secondary-action" onClick={onCancel} type="button">返回修改</button>
          <button className="primary-action" onClick={onConfirm} type="button">确认并继续</button>
        </div>
      </section>
    </div>
  );
}
