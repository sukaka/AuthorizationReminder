import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { expect, it } from 'vitest';

import App from '../src/App';
import { AdminLinksPage } from '../src/pages/admin/AdminLinksPage';
import { server } from './setup';

function session(role: string, managedDepartments: string[] = []) {
  server.use(
    http.get('/api/ai/session', () => HttpResponse.json({
      user: { id: `u-${role}`, username: `${role}用户`, role },
      scope: { department: managedDepartments[0] || null, managedDepartments },
      apps: ['ai-assistant'],
      local_binding_token: 'signed-binding-token',
    })),
    http.get('/api/ai/home', () => HttpResponse.json({
      favorites: [], recent_tasks: [], recent_generations: [], safety_reminders: [],
    })),
  );
}

it('shows AI governance pages to admin without user or server model forms', async () => {
  session('admin');
  render(<App />);

  await userEvent.click(await screen.findByRole('button', { name: '治理中心' }));
  expect(screen.getByRole('button', { name: '任务管理' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '知识库' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '系统设置' })).toBeInTheDocument();
  expect(screen.queryByText('服务端模型配置')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '新增用户' })).not.toBeInTheDocument();
});

it('keeps audit navigation aligned with the narrower audit capability', async () => {
  session('sysadmin');
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: '治理中心' }));
  expect(screen.getByRole('button', { name: '任务管理' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '审计日志' })).not.toBeInTheDocument();
});

it('shows department data and suggestions only to department managers', async () => {
  session('employee', ['销售部']);
  render(<App />);

  expect(await screen.findByRole('button', { name: '部门数据' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '提交建议' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '治理中心' })).not.toBeInTheDocument();
});

it('keeps governance and manager entries hidden from ordinary employees', async () => {
  session('employee');
  render(<App />);

  expect(await screen.findByText('上午好，employee用户')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '治理中心' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '部门数据' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '提交建议' })).not.toBeInTheDocument();
});

it('links user and prompt management to existing centers', () => {
  render(<AdminLinksPage urls={{
    adminCenter: 'http://localhost:5180/admin-center',
    promptCenter: 'http://localhost:18088',
  }} />);

  expect(screen.getByRole('link', { name: '打开统一用户管理' }))
    .toHaveAttribute('href', 'http://localhost:5180/admin-center');
  expect(screen.getByRole('link', { name: '打开提示词管理中心' }))
    .toHaveAttribute('href', 'http://localhost:18088');
});
