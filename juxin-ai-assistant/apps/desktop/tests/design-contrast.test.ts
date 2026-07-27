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

describe('task run layout', () => {
  it('keeps the task summary and work area responsive without changing theme colors', () => {
    expect(css).toMatch(/\.task-summary\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(260px,\s*\.45fr\)/s);
    expect(css).toMatch(/\.task-workspace\s*{[^}]*grid-template-columns:\s*minmax\(300px,\s*43fr\)\s+minmax\(420px,\s*57fr\)/s);
    expect(css).toMatch(/\.result-panel\s*{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;/s);
    expect(css).toMatch(/@media\s*\(max-width:\s*1060px\)[\s\S]*?\.task-summary,[\s\S]*?\.task-workspace[\s\S]*?grid-template-columns:\s*1fr;/);
    expect(css).toMatch(/@media\s*\(max-width:\s*760px\)[\s\S]*?\.task-summary,[\s\S]*?\.task-workspace[\s\S]*?grid-template-columns:\s*1fr;/);
  });
});

describe('chat workspace layout polish', () => {
  it('keeps controls in the workspace titlebar without wrapping or nested card boxes', () => {
    expect(css).toMatch(/\.chat-topbar\s*{[^}]*position:\s*fixed;[^}]*top:\s*7px;[^}]*left:\s*clamp\(360px,\s*26vw,\s*520px\);[^}]*right:\s*210px;/s);
    expect(css).toMatch(/\.chat-page\.has-chat-content \.chat-content-grid\s*{[^}]*padding-top:\s*16px;/s);
    expect(css).toMatch(/\.chat-composer-toolbar\s*{[^}]*flex-wrap:\s*nowrap;[^}]*overflow-x:\s*auto;/s);
    expect(css).toMatch(/\.chat-file-trigger\s*{[^}]*flex:\s*0 0 auto;/s);
    expect(css).toMatch(/\.chat-file-trigger span,\s*\.chat-reference-chip,\s*\.chat-model-pill\s*{[^}]*white-space:\s*nowrap;[^}]*flex:\s*0 0 auto;/s);
    expect(css).toMatch(/@media\s*\(max-width:\s*1280px\)[\s\S]*?\.chat-page:not\(\.has-chat-content\) \.chat-composer\s*{[^}]*width:\s*min\(680px,\s*100%\);[^}]*min-width:\s*0;/s);
    expect(css).toMatch(/@media\s*\(max-width:\s*900px\)[\s\S]*?\.chat-model-pill\s*{[^}]*display:\s*none;/s);
    expect(css).toMatch(/\.chat-sessions > div\[data-session-status\] > button\s*{[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s);
  });

  it('reclaims the space left by the removed progress rail', () => {
    const contentGridRule = css.match(
      /\.chat-page\.has-chat-content \.chat-content-grid\s*\{(?<body>[^}]+)\}/,
    )?.groups?.body;

    expect(contentGridRule).toBeDefined();
    expect(contentGridRule).toMatch(
      /width:\s*min\(1320px,\s*calc\(100% - 48px\)\)/,
    );
    expect(contentGridRule).toMatch(/margin-inline:\s*auto/);
    expect(contentGridRule).not.toContain('284px');
    expect(contentGridRule).not.toContain('236px');
  });

  it('indents only normal paragraphs in assistant replies', () => {
    const assistantParagraphRule = css.match(
      /\.chat-message\.assistant \.chat-message-content > p:not\(\.chat-source-attribution\)\s*\{(?<body>[^}]+)\}/,
    )?.groups?.body;

    expect(assistantParagraphRule).toBeDefined();
    expect(assistantParagraphRule).toMatch(/text-indent:\s*2em/);
    expect(css).not.toMatch(
      /\.chat-message\.user \.chat-message-content p\s*\{[^}]*text-indent:/s,
    );
  });

  it('keeps task recovery actions compact and visually prioritized', () => {
    expect(css).toMatch(
      /\.chat-run-context\s*{[^}]*grid-template-rows:\s*auto auto minmax\(0,\s*1fr\) auto;/s,
    );
    expect(css).toMatch(
      /\.chat-run-context-action-group\s*{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(112px,\s*1fr\)\);/s,
    );
    expect(css).toMatch(
      /\.chat-run-context-action\.is-primary\s*{[^}]*background:\s*var\(--accent\);[^}]*color:\s*white;/s,
    );
    expect(css).toMatch(
      /\.chat-run-context-action\.is-tertiary\s*{[^}]*border:\s*0;[^}]*background:\s*transparent;/s,
    );
  });

  it('polishes the empty chat state instead of only the generated-content state', () => {
    expect(css).toMatch(/\.chat-sessions > div\[data-session-status\]\s*{[^}]*border:\s*1px solid[^;]+;[^}]*border-radius:\s*18px;[^}]*background:\s*var\(--surface-solid\);[^}]*box-shadow:/s);
    expect(css).toMatch(/\.chat-sessions > div\[data-session-status\] > button:hover,\s*\.chat-sessions > div\[data-session-status\] > button:focus-visible\s*{[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s);
    expect(css).toMatch(/\.chat-page:not\(\.has-chat-content\) \.chat-composer\s*{[^}]*width:\s*min\(720px,\s*52vw\);/s);
  });
});
