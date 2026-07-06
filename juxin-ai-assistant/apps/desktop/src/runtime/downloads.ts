import { invoke } from '@tauri-apps/api/core';

import { isDesktopRuntime } from './capabilities';

function readFileNameFromDisposition(disposition: string | null, fallbackFileName: string): string {
  if (!disposition) return fallbackFileName;
  const encodedMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1].replace(/"/g, ''));
    } catch {
      return encodedMatch[1].replace(/"/g, '');
    }
  }
  const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1] || fallbackFileName;
}

export async function downloadBlobFromResponse(
  response: Response,
  fallbackFileName: string,
): Promise<string> {
  const blob = await response.blob();
  const fileName = readFileNameFromDisposition(
    response.headers.get('Content-Disposition'),
    fallbackFileName,
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return fileName;
}

export async function openLocalWordFile(path: string): Promise<'opened' | 'unsupported'> {
  if (!isDesktopRuntime()) return 'unsupported';
  await invoke('generation_word_open', { path });
  return 'opened';
}

export async function saveWordBytesToDesktop(
  fileName: string,
  bytes: Uint8Array,
): Promise<string> {
  return invoke<string>('generation_word_save', {
    fileName,
    bytes: Array.from(bytes),
  });
}
