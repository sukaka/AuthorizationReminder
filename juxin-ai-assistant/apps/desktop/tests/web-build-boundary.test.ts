import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', 'src');
const allowed = [
  'remote/desktopBridge.ts',
  'runtime/downloads.ts',
  'pages/ModelProfilesPage.tsx',
];

function isAllowedDesktopModule(file: string): boolean {
  return allowed.includes(file) || /^local\/[^/]+\.ts$/.test(file) || file.startsWith('launcher/');
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (/\.(ts|tsx)$/.test(path)) return [path];
    return [];
  });
}

describe('web build tauri boundary', () => {
  it('keeps direct Tauri imports inside approved desktop-only modules', () => {
    const offenders = sourceFiles(root)
      .map((file) => relative(root, file))
      .filter((file) => !isAllowedDesktopModule(file))
      .filter((file) => readFileSync(join(root, file), 'utf8').includes('@tauri-apps/api'));

    expect(offenders).toEqual([]);
  });
});
