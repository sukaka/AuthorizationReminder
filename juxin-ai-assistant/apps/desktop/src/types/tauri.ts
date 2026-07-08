export type ModelProfile = {
  id: string;
  displayName: string;
  baseUrl: string;
  modelId: string;
  temperature: number;
  maxOutputTokens: number;
  maxAutoContinues: number;
  timeoutSeconds: number;
  isDefault: boolean;
  hasApiKey: boolean;
};

export type ModelGenerateResult = {
  output: string;
  latencyMs: number;
  usage: Record<string, unknown>;
  finishReason?: string | null;
  truncated?: boolean;
  autoContinueCount?: number;
};

declare global {
  interface Window {
    __JUXIN_DESKTOP_AUTH_PORTAL__?: string;
    __JUXIN_RUNTIME_PLATFORM__?: 'web' | 'desktop';
    __TAURI_INTERNALS__?: {
      invoke?: (
        command: string,
        args?: Record<string, unknown>,
      ) => Promise<unknown>;
      metadata?: {
        currentWebview?: {
          label?: string;
        };
      };
    };
  }
}
