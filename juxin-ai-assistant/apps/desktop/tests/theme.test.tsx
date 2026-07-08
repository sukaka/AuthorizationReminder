import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ThemeProvider } from '../src/theme/ThemeProvider';

describe('ThemeProvider', () => {
  it('offers system, light and dark choices', () => {
    render(
      <ThemeProvider>
        <div>content</div>
      </ThemeProvider>,
    );

    expect(screen.getByRole('button', { name: '跟随系统' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '浅色' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '深色' })).toBeInTheDocument();
  });

  it('persists an explicit theme selection', async () => {
    render(
      <ThemeProvider>
        <div>content</div>
      </ThemeProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: '深色' }));

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('juxin-ai-theme')).toBe('dark');
  });
});
