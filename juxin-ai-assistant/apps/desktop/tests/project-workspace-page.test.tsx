import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { expect, it, vi } from 'vitest';

import App from '../src/App';
import { ProjectWorkspacePage } from '../src/pages/ProjectWorkspacePage';
import { server } from './setup';

vi.mock('../src/pages/ChatPage', () => ({
  ChatPage: ({ initialProjectUuid }: { initialProjectUuid?: string }) => (
    <div data-testid="project-chat-page">{initialProjectUuid}</div>
  ),
}));

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
  const tasksByProject = new Map<string, typeof task[]>([['project-a', [task]]]);
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
      return HttpResponse.json(tasksByProject.get(String(params.projectUuid)) || []);
    }),
    http.post('/api/ai/projects/:projectUuid/tasks', async ({ params, request }) => {
      const body = await request.json() as { title: string; description: string; priority: string };
      const createdTask = { ...task, task_uuid: 'task-created', ...body };
      const projectUuid = String(params.projectUuid);
      taskCreate?.(body);
      tasksByProject.set(projectUuid, [createdTask, ...(tasksByProject.get(projectUuid) || [])]);
      return HttpResponse.json(createdTask, { status: 201 });
    }),
    http.post('/api/ai/projects/:projectUuid/tasks/:taskUuid/status', async ({ params, request }) => {
      const body = await request.json() as { status: string };
      const projectUuid = String(params.projectUuid);
      const taskUuid = String(params.taskUuid);
      const updatedTask = (tasksByProject.get(projectUuid) || []).find((item) => item.task_uuid === taskUuid);
      if (!updatedTask) return new HttpResponse(null, { status: 404 });
      updatedTask.status = body.status;
      return HttpResponse.json(updatedTask);
    }),
    http.put('/api/ai/projects/:projectUuid/tasks/:taskUuid', async ({ params, request }) => {
      const body = await request.json() as { title: string; description: string; priority: string };
      const projectUuid = String(params.projectUuid);
      const taskUuid = String(params.taskUuid);
      const updatedTask = (tasksByProject.get(projectUuid) || []).find((item) => item.task_uuid === taskUuid);
      if (!updatedTask) return new HttpResponse(null, { status: 404 });
      Object.assign(updatedTask, body);
      return HttpResponse.json(updatedTask);
    }),
    http.delete('/api/ai/projects/:projectUuid/tasks/:taskUuid', ({ params }) => {
      const projectUuid = String(params.projectUuid);
      const taskUuid = String(params.taskUuid);
      tasksByProject.set(projectUuid, (tasksByProject.get(projectUuid) || []).filter((item) => item.task_uuid !== taskUuid));
      return new HttpResponse(null, { status: 204 });
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

it('opens project chat in a dialog and keeps the selected project context', async () => {
  const user = userEvent.setup();
  installProjectHandlers();

  render(<ProjectWorkspacePage />);
  expect(await screen.findByRole('heading', { name: '星河交付项目' })).toBeInTheDocument();

  const openButton = screen.getByRole('button', { name: '项目聊天' });
  expect(screen.queryByRole('tab', { name: '项目对话' })).not.toBeInTheDocument();

  await user.click(openButton);

  const dialog = await screen.findByRole('dialog', { name: '星河交付项目' });
  expect(within(dialog).getByTestId('project-chat-page')).toHaveTextContent('project-a');

  await user.click(within(dialog).getByRole('button', { name: '关闭项目聊天' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(openButton).toHaveFocus();
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

  await userEvent.click(screen.getByRole('button', { name: '编辑 整理项目周报' }));
  await userEvent.clear(screen.getByRole('textbox', { name: '编辑任务标题' }));
  await userEvent.type(screen.getByRole('textbox', { name: '编辑任务标题' }), '归档项目周报');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: '编辑任务优先级' }), 'high');
  await userEvent.click(screen.getByRole('button', { name: '保存任务' }));
  expect(await screen.findByText('归档项目周报')).toBeInTheDocument();

  await userEvent.selectOptions(screen.getByRole('combobox', { name: '任务状态 归档项目周报' }), 'in_progress');
  await waitFor(() => expect(screen.getByText('处理中', { selector: '.project-status' })).toBeInTheDocument());

  await userEvent.click(screen.getByRole('button', { name: '删除 归档项目周报' }));
  const deleteDialog = await screen.findByRole('dialog', { name: '删除项目任务' });
  await userEvent.click(within(deleteDialog).getByRole('button', { name: '确认删除' }));
  await waitFor(() => expect(screen.queryByText('归档项目周报')).not.toBeInTheDocument());
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
