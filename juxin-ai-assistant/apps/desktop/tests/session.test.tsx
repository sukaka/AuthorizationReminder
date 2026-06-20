import { render, screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import App from '../src/App';
import { getAuthPortalUrl } from '../src/api/client';
import { server } from './setup';

describe('unified session shell', () => {
  it('uses the existing unified portal instead of inventing a child login route', () => {
    expect(getAuthPortalUrl()).toBe('http://localhost:5180/portal?system=ai-assistant');
    expect(getAuthPortalUrl()).not.toContain('/login');
  });

  it('renders the authenticated workspace without a password form', async () => {
    server.use(
      http.get('/api/ai/session', () =>
        HttpResponse.json({
          user: { id: 'u-1', username: '张磊', role: 'employee' },
          scope: { department: '技术部', managedDepartments: [] },
          apps: ['ai-assistant'],
          local_binding_token: 'signed-binding-token',
        }),
      ),
    );

    render(<App />);

    expect(await screen.findByText('上午好，张磊')).toBeInTheDocument();
    expect(screen.queryByLabelText('密码')).not.toBeInTheDocument();
  });

  it('shows a permission state returned by the unified platform', async () => {
    server.use(
      http.get('/api/ai/session', () =>
        HttpResponse.json(
          { success: false, code: 'FORBIDDEN', message: '无权访问聚信 AI 助手', data: null },
          { status: 403 },
        ),
      ),
    );

    render(<App />);

    expect(await screen.findByText('暂时无法进入工作台')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回统一门户' })).toBeInTheDocument();
  });
});
