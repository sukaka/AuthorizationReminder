import { Component, type ErrorInfo, type ReactNode } from 'react';

type WorkspaceErrorBoundaryProps = {
  children: ReactNode;
  onReload: () => void;
  onReturnHome: () => void;
};

type WorkspaceErrorBoundaryState = {
  failed: boolean;
};

export class WorkspaceErrorBoundary extends Component<
  WorkspaceErrorBoundaryProps,
  WorkspaceErrorBoundaryState
> {
  state: WorkspaceErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): WorkspaceErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // The user-facing fallback intentionally omits exception details.
  }

  private returnHome = (): void => {
    this.setState({ failed: false });
    this.props.onReturnHome();
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="status-view workspace-error-fallback" role="alert">
        <span className="status-symbol" aria-hidden="true">↻</span>
        <h1>页面暂时无法显示</h1>
        <p>当前页面遇到异常，你可以重新加载，或返回工作台继续使用其他功能。</p>
        <div className="workspace-error-actions">
          <button onClick={this.props.onReload} type="button">重新加载</button>
          <button onClick={this.returnHome} type="button">返回工作台</button>
        </div>
      </section>
    );
  }
}
