import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'src/theme/tokens.css'),
  'utf8',
);

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const values = hex
    .slice(1)
    .match(/.{2}/g)
    ?.map((value) => channel(Number.parseInt(value, 16)));
  if (!values || values.length !== 3) {
    throw new TypeError(`Unsupported color: ${hex}`);
  }
  return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
}

function contrast(foreground: string, background: string): number {
  const high = Math.max(luminance(foreground), luminance(background));
  const low = Math.min(luminance(foreground), luminance(background));
  return (high + 0.05) / (low + 0.05);
}

function themeBlock(selector: string): string {
  const start = css.indexOf(selector);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  if (start < 0 || open < 0 || close < 0) {
    throw new TypeError(`Missing theme block: ${selector}`);
  }
  return css.slice(open + 1, close);
}

function token(block: string, name: string): string {
  const match = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new TypeError(`Missing color token: ${name}`);
  return match[1];
}

describe('launcher color contrast', () => {
  it.each([
    [':root,', '#ffffff'],
    ["[data-theme='dark']", '#27282b'],
  ])('%s keeps small semantic text at WCAG AA contrast', (selector, surface) => {
    const block = themeBlock(selector);

    for (const name of [
      '--accent-text',
      '--success-text',
      '--danger-text',
    ]) {
      expect(contrast(token(block, name), surface), name).toBeGreaterThanOrEqual(
        4.5,
      );
    }
    expect(
      contrast(token(block, '--accent-strong'), '#ffffff'),
      '--accent-strong',
    ).toBeGreaterThanOrEqual(4.5);
  });
});
