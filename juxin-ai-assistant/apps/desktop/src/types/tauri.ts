export type ModelProfile = {
  id: string;
  displayName: string;
  baseUrl: string;
  modelId: string;
  temperature: number;
  timeoutSeconds: number;
  isDefault: boolean;
  hasApiKey: boolean;
};

export type ModelGenerateResult = {
  output: string;
  latencyMs: number;
  usage: Record<string, number>;
};

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}
