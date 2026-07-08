type LocalDataDialogProps = {
  readonly onClose: () => void;
};

export function LocalDataDialog({ onClose }: LocalDataDialogProps) {
  return (
    <dialog
      aria-labelledby="local-data-title"
      className="local-data-dialog"
      open
    >
      <header>
        <div>
          <span className="launcher-eyebrow">设备内安全保存</span>
          <h2 id="local-data-title">本机草稿与待同步</h2>
        </div>
        <button
          aria-label="关闭本机数据状态"
          className="launcher-link"
          onClick={onClose}
          type="button"
        >
          关闭
        </button>
      </header>
      <p>统一登录确认身份后开放，避免不同用户查看彼此内容。</p>
      <div className="local-data-status-list">
        <article>
          <strong>草稿内容</strong>
          <span>按远程服务器和统一账号隔离，保留在当前设备。</span>
        </article>
        <article>
          <strong>待同步结果</strong>
          <span>网络恢复并确认同一服务器与账号后才会继续同步。</span>
        </article>
      </div>
    </dialog>
  );
}
