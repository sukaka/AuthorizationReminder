import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { expect, it, vi } from 'vitest';

import App from '../src/App';
import { ProjectWorkspacePage } from '../src/pages/ProjectWorkspacePage';
import { server } from './setup';

const projectA = {
  project_uuid: 'project-a',
  name: '星河交付项目',
  description: '面向客户的交付协作空间',
  status: 'active',
  owner_user_id: 'u-owner',
  created_at: '2026-07-10T00:00:00Z',
  updated_at: '2026-07-13T00:00:00Z',
};

const projectB = {
  project_uuid: 'project-b',
  name: '内部流程优化',
  description: '梳理交付团队的工作流程',
  status: 'active',
  owner_user_id: 'u-owner',
  created_at: '2026-07-09T00:00:00Z',
  updated_at: '2026-07-12T00:00:00Z',
};

function installProjectHandlers(taskCreate?: (body: { title: string; description: string; priority: string }) => void) {
  const task = {
    task_uuid: 'task-1',
    title: '确认交付范围',
    description: '和客户确认本周交付边界',
    status: 'todo',
    priority: 'high',
    assignee_user_id: 'u-owner',
    due_at: null,
    created_by: 'u-owner',
    created_at: '2026-07-13T00:00:00Z',
    updated_at: '2026-07-13T00:00:00Z',
  };
  const details = new Map([
    ['project-a', { ...projectA, members: [{ member_uuid: 'member-1', user_id: 'u-owner', role: 'project_lead', status: 'active', invited_by: 'u-owner', created_at: '2026-07-10T00:00:00Z' }] }],
    ['project-b', { ...projectB, members: [] }],
  ]);

  server.use(
    http.get('/api/ai/projects', () => HttpResponse.json([projectA, projectB])),
    http.post('/api/ai/projects', async ({ request }) => {
      const body = await request.json() as { name: string; description: string };
      return HttpResponse.json({ ...projectB, project_uuid: 'project-new', name: body.name, description: body.description }, { status: 201 });
    }),
    http.get('/api/ai/projects/:projectUuid', ({ params }) => {
      if (params.projectUuid === 'project-new') {
        return HttpResponse.json({ ...projectB, project_uuid: 'project-new', name: '客户复盘项目', description: '沉淀项目复盘结论', members: [] });
      }
      return HttpResponse.json(details.get(String(params.projectUuid)) || { ...projectB, members: [] });
    }),
    http.get('/api/ai/projects/:projectUuid/tasks', ({ params }) => {
      return HttpResponse.json(params.projectUuid === 'project-a' ? [task] : []);
    }),
    http.post('/api/ai/projects/:projectUuid/tasks', async ({ request }) => {
      const body = await request.json() as { title: string; description: string; priority: string };
      taskCreate?.(body);
      return HttpResponse.json({ ...task, task_uuid: 'task-created', ...body }, { status: 201 });
    }),
    http.post('/api/ai/projects/:projectUuid/tasks/:taskUuid/status', async ({ request }) => {
      const body = await request.json() as { status: string };
      return HttpResponse.json({ ...task, status: body.status });
    }),
    http.get('/api/ai/projects/:projectUuid/deliverables', () => HttpResponse.json([])),
    http.get('/api/ai/projects/:projectUuid/issues', () => HttpResponse.json([])),
    http.get('/api/ai/projects/:projectUuid/activities', () => HttpResponse.json([])),
  );
}

it('loads projects and switches the project workspace context', async () => {
  installProjectHandlers();

  render(<ProjectWorkspacePage />);

  expect(await screen.findByRole('heading', { name: '项目工作空间' })).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: '星河交付项目' })).toBeInTheDocument();
  expect(screen.getByText('确认交付范围')).toBeInTheDocument();
  expect(screen.getAllByText('1', { selector: '.project-stat-strip strong' })).toHaveLength(2);

  await userEvent.click(screen.getByRole('button', { name: /内部流程优化/ }));

  expect(await screen.findByRole('heading', { name: '内部流程优化' })).toBeInTheDocument();
  expect(screen.getByText('暂无任务')).toBeInTheDocument();
});

it('creates a project task and updates its status', async () => {
  const taskCreate = vi.fn();
  installProjectHandlers(taskCreate);

  render(<ProjectWorkspacePage />);
  expect(await screen.findByRole('heading', { name: '星河交付项目' })).toBeInTheDocument();

  await userEvent.type(screen.getByRole('textbox', { name: '任务标题' }), '整理项目周报');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: '任务优先级' }), 'urgent');
  await userEvent.type(screen.getByRole('textbox', { name: '任务描述' }), '汇总本周项目进展');
  await userEvent.click(screen.getByRole('button', { name: '添加任务' }));

  await waitFor(() => expect(taskCreate).toHaveBeenCalledWith({
    title: '整理项目周报',
    description: '汇总本周项目进展',
    priority: 'urgent',
  }));
  expect(await screen.findByText('整理项目周报')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '开始处理 整理项目周报' }));
  await waitFor(() => expect(screen.getByText('处理中')).toBeInTheDocument());
});

it('creates a project from the workspace header', async () => {
  installProjectHandlers();

  render(<ProjectWorkspacePage />);
  expect(await screen.findByRole('heading', { name: '项目工作空间' })).toBeInTheDocument();

  await userEvent.type(screen.getByRole('textbox', { name: '新项目名称' }), '客户复盘项目');
  await userEvent.type(screen.getByRole('textbox', { name: '项目描述' }), '沉淀项目复盘结论');
  await userEvent.click(screen.getByRole('button', { name: '创建项目' }));

  expect(await screen.findByRole('heading', { name: '客户复盘项目' })).toBeInTheDocument();
});

it('opens the project workspace from the main navigation', async () => {
  installProjectHandlers();
  server.use(
    http.get('/api/ai/session', () => HttpResponse.json({
      user: { id: 'u-employee', username: '员工用户', role: 'employee' },
      scope: { department: '交付部', managedDepartments: [] },
      apps: ['ai-assistant'],
      local_binding_token: 'signed-binding-token',
    })),
    http.get('/api/ai/home', () => HttpResponse.json({
      favorites: [], recent_tasks: [], recent_generations: [], safety_reminders: [],
    })),
  );

  render(<App />);

  await userEvent.click(await screen.findByRole('button', { name: '项目' }));
  expect(await screen.findByRole('heading', { name: '项目工作空间' })).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: '星河交付项目' })).toBeInTheDocument();
});
