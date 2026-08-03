import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Reads `src/theme/index.css` and recursively inlines its relative
 * `@import './xxx.css';` statements, returning the concatenated CSS text in
 * cascade order (theme tokens first, then the split style files).
 */
export function readThemeCss(): string {
  const entry = resolve(process.cwd(), 'src/theme/index.css');

  const inline = (file: string, seen: Set<string>): string => {
    const source = readFileSync(file, 'utf8');
    return source.replace(/@import '(\.\/[^']+)';/g, (statement, specifier: string) => {
      const target = resolve(dirname(file), specifier);
      if (seen.has(target)) {
        return statement;
      }
      seen.add(target);
      return inline(target, seen);
    });
  };

  return inline(entry, new Set([entry]));
}
