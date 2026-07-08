export type SensitiveFinding = {
  code: string;
  field: string;
  preview: string;
};

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
        <p>当前内容可能包含个人或企业敏感信息。确认后仅将本次内容发送给你选择的本地模型。</p>
        <ul>
          {findings.map((finding, index) => (
            <li key={`${finding.code}-${finding.field}-${index}`}>
              <strong>{finding.field || '输入内容'}</strong>
              <span>{finding.code} · {finding.preview || '已隐藏'}</span>
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
