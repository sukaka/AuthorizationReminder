import type { ProbeFailureKind } from '../remote/desktopBridge';
export {
  validateServerOrigin,
  type OriginValidation,
} from '../buildMode';

export type LauncherState =
  | { readonly kind: 'booting' }
  | {
      readonly kind: 'needs-server';
      readonly origin: string;
      readonly notice?: string;
    }
  | { readonly kind: 'checking'; readonly origin: string }
  | { readonly kind: 'server-ready'; readonly origin: string }
  | {
      readonly kind: 'server-unreachable';
      readonly origin: string;
      readonly reason: ProbeFailureKind;
    }
  | { readonly kind: 'authenticating'; readonly origin: string }
  | { readonly kind: 'workspace-ready'; readonly origin: string };

export function launcherStatusContent(state: LauncherState) {
  switch (state.kind) {
    case 'booting':
      return { tone: 'neutral', message: '正在读取本机设置…' } as const;
    case 'needs-server':
      return {
        tone: state.notice ? 'neutral' : 'muted',
        message: state.notice ?? '请先填写远程服务地址并测试连接。',
      } as const;
    case 'checking':
      return { tone: 'neutral', message: '正在验证服务和登录能力…' } as const;
    case 'server-ready':
      return { tone: 'success', message: '连接成功，可以使用统一登录。' } as const;
    case 'server-unreachable':
      return {
        tone: 'danger',
        message: probeFailureMessage(state.reason),
      } as const;
    case 'authenticating':
      return { tone: 'neutral', message: '正在打开统一登录…' } as const;
    case 'workspace-ready':
      return { tone: 'success', message: '工作台已就绪。' } as const;
    default:
      return assertNever(state);
  }
}

export function probeFailureMessage(kind: ProbeFailureKind): string {
  switch (kind) {
    case 'dns':
      return '无法解析服务器地址，请检查域名或当前网络。';
    case 'tls':
      return '服务器证书不受信任或已过期，请联系管理员处理。';
    case 'timeout':
      return '服务器暂未响应，请稍后重试或修改地址。';
    case 'product':
      return '该地址不是兼容的聚信 AI 助手服务。';
    case 'protocol':
      return '客户端与服务器版本不兼容，请先检查更新。';
    case 'connection':
      return '无法连接远程服务，请检查网络或服务器状态。';
    default:
      return assertNever(kind);
  }
}

export function assertNever(value: never): never {
  throw new TypeError(`Unexpected launcher state: ${String(value)}`);
}
