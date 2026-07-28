import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { expect, it, vi } from 'vitest';

import { ProjectWorkspaceExtendedPanel } from '../src/components/ProjectWorkspaceExtendedPanel';
import { server } from './setup';

const projectUuid = 'project-a';

const contract = {
  contract_uuid: 'contract-1',
  name: '年度服务合同',
  contract_no: '',
  customer_name: '星河科技',
  source_file_uuid: null,
  extraction_status: 'manual',
  extracted_payload: {},
  status: 'draft',
  confirmed_by: null,
  confirmed_at: null,
  created_at: '2026-07-13T00:00:00Z',
  updated_at: '2026-07-13T00:00:00Z',
};

function installInitializationHandlers(confirmContract?: () => void, createScopeVersion?: (payload: unknown) => void) {
  server.use(
    http.get(`/api/ai/projects/${projectUuid}/initialization`, () => HttpResponse.json({
      project_uuid: projectUuid,
      initialization_complete: false,
      counts: { contracts: 1, service_scopes: 1, systems: 1, assets: 0, target_groups: 0, service_targets: 0, execution_rules: 0 },
    })),
    http.get(`/api/ai/projects/${projectUuid}/contracts`, () => HttpResponse.json([contract])),
    http.get(`/api/ai/projects/${projectUuid}/service-scopes`, () => HttpResponse.json([{
      scope_uuid: 'scope-1', contract_uuid: 'contract-1', name: '安全评估', category: '', description: '', frequency: 'monthly', deliverable: '报告', acceptance_criteria: '', status: 'draft', confirmation_status: 'pending', current_version: 1, confirmed_by: null, confirmed_at: null, created_at: '2026-07-13T00:00:00Z', updated_at: '2026-07-13T00:00:00Z',
    }])),
    http.get(`/api/ai/projects/${projectUuid}/systems`, () => HttpResponse.json([])),
    http.get(`/api/ai/projects/${projectUuid}/assets`, () => HttpResponse.json([])),
    http.get(`/api/ai/projects/${projectUuid}/target-groups`, () => HttpResponse.json([])),
    http.get(`/api/ai/projects/${projectUuid}/service-targets`, () => HttpResponse.json([])),
    http.get(`/api/ai/projects/${projectUuid}/execution-rules`, () => HttpResponse.json([])),
    http.post(`/api/ai/projects/${projectUuid}/contracts/contract-1/confirm`, () => {
      confirmContract?.();
      return HttpResponse.json({ ...contract, confirmed_by: 'u-owner', confirmed_at: '2026-07-14T00:00:00Z' });
    }),
    http.post(`/api/ai/projects/${projectUuid}/service-scopes/scope-1/versions`, async ({ request }) => {
      createScopeVersion?.(await request.json());
      return HttpResponse.json({ version_uuid: 'version-2', scope_uuid: 'scope-1', version: 2, snapshot_json: {}, change_summary: '补充验收标准', created_by: 'u-owner', created_at: '2026-07-14T00:00:00Z' });
    }),
  );
}

it('loads initialization resources and confirms a contract', async () => {
  const confirmContract = vi.fn();
  const createScopeVersion = vi.fn();
  installInitializationHandlers(confirmContract, createScopeVersion);

  render(<ProjectWorkspaceExtendedPanel activeTab="initialization" projectUuid={projectUuid} />);

  expect(await screen.findByRole('heading', { name: '项目初始化' })).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: '确认合同 年度服务合同' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '确认合同 年度服务合同' }));

  await waitFor(() => expect(confirmContract).toHaveBeenCalledTimes(1));
  expect(await screen.findByText('已确认')).toBeInTheDocument();

  await userEvent.selectOptions(screen.getByRole('combobox', { name: '版本服务范围' }), 'scope-1');
  await userEvent.type(screen.getByRole('textbox', { name: '版本变更摘要' }), '补充验收标准');
  await userEvent.click(screen.getByRole('button', { name: '创建版本' }));
  await waitFor(() => expect(createScopeVersion).toHaveBeenCalledWith(expect.objectContaining({ change_summary: '补充验收标准' })));
});

it('updates and removes project members from the permission panel', async () => {
  const updateMember = vi.fn();
  const removeMember = vi.fn();
  const members = [
    { member_uuid: 'member-owner', user_id: 'u-owner', username: '负责人', role: 'project_lead', status: 'active', invited_by: 'u-owner', created_at: '2026-07-13T00:00:00Z' },
    { member_uuid: 'member-alice', user_id: 'alice', username: 'alice', role: 'member', status: 'active', invited_by: 'u-owner', created_at: '2026-07-13T00:00:00Z' },
  ];
  server.use(
    http.get(`/api/ai/projects/${projectUuid}/members`, () => HttpResponse.json(members)),
    http.get(`/api/ai/projects/${projectUuid}/member-candidates`, () => HttpResponse.json([])),
    http.patch(`/api/ai/projects/${projectUuid}/members/member-alice`, async ({ request }) => {
      updateMember(await request.json());
      return HttpResponse.json({ ...members[1], role: 'reviewer' });
    }),
    http.delete(`/api/ai/projects/${projectUuid}/members/member-alice`, () => {
      removeMember();
      return new HttpResponse(null, { status: 204 });
    }),
  );

  render(<ProjectWorkspaceExtendedPanel activeTab="members" projectUuid={projectUuid} />);

  expect(await screen.findByText('alice')).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'alice 的角色' }), 'reviewer');
  await waitFor(() => expect(updateMember).toHaveBeenCalledWith({ role: 'reviewer' }));
  await userEvent.click(screen.getByRole('button', { name: '移除成员 alice' }));

  await waitFor(() => expect(removeMember).toHaveBeenCalledTimes(1));
  expect(screen.queryByText('alice')).not.toBeInTheDocument();
});

it('links project resources and copies a project artifact to personal space', async () => {
  const linkFile = vi.fn();
  const linkArtifact = vi.fn();
  const copyArtifact = vi.fn();
  server.use(
    http.get(`/api/ai/projects/${projectUuid}/files`, () => HttpResponse.json([])),
    http.get(`/api/ai/projects/${projectUuid}/artifacts`, () => HttpResponse.json([{
      artifact_uuid: 'artifact-1', project_artifact_uuid: 'project-artifact-1', title: '项目报告', artifact_type: 'word_document', content_summary: '报告摘要', file_name: 'report.docx', status: 'active', linked_by: 'u-owner', created_at: '2026-07-13T00:00:00Z',
    }])),
    http.get('/api/knowledge/files', () => HttpResponse.json({
      items: [{
        file_uuid: 'file-1',
        file_name: '方案.docx',
        file_type: 'docx',
        file_size: 1024,
        visibility: 'private',
        status: 'READY',
        chunk_count: 3,
        created_at: '2026-07-13T00:00:00Z',
        category: '个人资料',
        usage_type: 'personal_reference',
      }],
      total: 1,
    })),
    http.get('/api/ai/work-artifacts', () => HttpResponse.json({
      items: [{
        artifact_uuid: 'artifact-2',
        conversation_id: 'conversation-1',
        message_id: 'message-1',
        title: '新增成果',
        artifact_type: 'ordinary_answer',
        source_scope: 'personal',
        source_summary: [],
        content_summary: '新增成果摘要',
        file_name: '',
        version: 1,
        status: 'active',
        created_at: '2026-07-13T00:00:00Z',
        updated_at: '2026-07-13T00:00:00Z',
      }],
      total: 1,
      page: 1,
      page_size: 100,
    })),
    http.get('/api/conversations', () => HttpResponse.json({
      items: [{
        session_uuid: 'session-1',
        title: '个人方案讨论',
        mode: 'normal',
        status: 'active',
        workspace_type: 'personal',
        project_uuid: null,
        created_at: '2026-07-13T00:00:00Z',
        updated_at: '2026-07-14T00:00:00Z',
      }],
      total: 1,
    })),
    http.post(`/api/ai/projects/${projectUuid}/files/file-1`, () => {
      linkFile();
      return HttpResponse.json({ file_uuid: 'file-1', project_file_uuid: 'project-file-1', file_name: '方案.docx', file_type: 'docx', category: '项目资料', summary: '', status: 'active', linked_by: 'u-owner', created_at: '2026-07-14T00:00:00Z' });
    }),
    http.post(`/api/ai/projects/${projectUuid}/artifacts/artifact-2`, () => {
      linkArtifact();
      return HttpResponse.json({ artifact_uuid: 'artifact-2', project_artifact_uuid: 'project-artifact-2', title: '新增成果', artifact_type: 'ordinary_answer', content_summary: '新增成果摘要', file_name: '', status: 'active', linked_by: 'u-owner', created_at: '2026-07-14T00:00:00Z' });
    }),
    http.post(`/api/ai/projects/${projectUuid}/artifacts/artifact-1/copy-to-personal`, async ({ request }) => {
      copyArtifact(await request.json());
      return HttpResponse.json({ artifact_id: 2, artifact_uuid: 'artifact-copy-1', sanitized: true }, { status: 201 });
    }),
  );

  render(<ProjectWorkspaceExtendedPanel activeTab="knowledge" projectUuid={projectUuid} />);

  expect(await screen.findByRole('heading', { name: '资料与知识' })).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByRole('combobox', { name: '选择个人资料' }), 'file-1');
  await userEvent.click(screen.getByRole('button', { name: '关联文件' }));
  await waitFor(() => expect(linkFile).toHaveBeenCalledTimes(1));

  await userEvent.selectOptions(screen.getByRole('combobox', { name: '选择个人成果' }), 'artifact-2');
  await userEvent.click(screen.getByRole('button', { name: '关联成果' }));
  await waitFor(() => expect(linkArtifact).toHaveBeenCalledTimes(1));
  await userEvent.click(screen.getByRole('button', { name: '复制成果到个人 项目报告' }));
  await waitFor(() => expect(copyArtifact).toHaveBeenCalledWith({ sanitized_title: '项目报告（个人副本）', sanitized_content_summary: '报告摘要' }));
});

it('adds a project member from the enterprise user directory', async () => {
  const addMember = vi.fn();
  server.use(
    http.get(`/api/ai/projects/${projectUuid}/members`, () => HttpResponse.json([])),
    http.get(`/api/ai/projects/${projectUuid}/member-candidates`, () => HttpResponse.json([{
      user_id: '23',
      username: '李雷',
      role: 'user',
      department_code: '销售部',
    }])),
    http.post(`/api/ai/projects/${projectUuid}/members`, async ({ request }) => {
      addMember(await request.json());
      return HttpResponse.json({
        member_uuid: 'member-lilei',
        user_id: '23',
        username: '李雷',
        role: 'reviewer',
        status: 'active',
        invited_by: 'u-owner',
        created_at: '2026-07-14T00:00:00Z',
      }, { status: 201 });
    }),
  );

  render(<ProjectWorkspaceExtendedPanel activeTab="members" projectUuid={projectUuid} />);

  expect(await screen.findByRole('option', { name: '李雷 · 销售部 · user' })).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByRole('combobox', { name: '选择企业用户' }), '23');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: '新成员角色' }), 'reviewer');
  await userEvent.click(screen.getByRole('button', { name: '添加成员' }));

  await waitFor(() => expect(addMember).toHaveBeenCalledWith({ user_id: '23', role: 'reviewer' }));
  expect(await screen.findByText('李雷')).toBeInTheDocument();
});
