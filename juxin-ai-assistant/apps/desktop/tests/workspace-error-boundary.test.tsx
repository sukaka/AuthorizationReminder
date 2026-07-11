import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';

import { WorkspaceErrorBoundary } from '../src/components/WorkspaceErrorBoundary';

function BrokenPage(): never {
  throw new Error('sensitive internal failure');
}

it('shows a recoverable fallback without exposing exception details', async () => {
  const reload = vi.fn();
  const returnHome = vi.fn();
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  render(
    <WorkspaceErrorBoundary onReload={reload} onReturnHome={returnHome}>
      <BrokenPage />
    </WorkspaceErrorBoundary>,
  );

  expect(screen.getByRole('heading', { name: '页面暂时无法显示' })).toBeInTheDocument();
  expect(screen.queryByText('sensitive internal failure')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '重新加载' }));
  expect(reload).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: '返回工作台' }));
  expect(returnHome).toHaveBeenCalledTimes(1);

  consoleError.mockRestore();
});
