import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

import { ModelProfilesPage } from '../src/pages/ModelProfilesPage';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((command: string) => {
    if (command === 'model_profile_list') {
      return Promise.resolve([
        {
          id: 'profile-1',
          displayName: '公司模型',
          baseUrl: 'https://model.example/v1/',
          modelId: 'example-model',
          temperature: 0.3,
          timeoutSeconds: 60,
          isDefault: true,
          hasApiKey: true,
        },
      ]);
    }
    if (command === 'model_profile_test') {
      return Promise.resolve({ ok: true, message: '公司模型 连接成功' });
    }
    return Promise.resolve();
  });
});

it('tests and deletes a profile without exposing its secret', async () => {
  render(<ModelProfilesPage />);

  expect(await screen.findByText((content) =>
    content.includes('密钥会加密保存在本机，页面无法读取明文。'),
  )).toBeInTheDocument();
  expect(screen.queryByText('为什么会访问钥匙串？')).not.toBeInTheDocument();
  expect(await screen.findByText('密钥已配置')).toBeInTheDocument();
  expect(screen.queryByDisplayValue(/secret|key-/i)).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '测试连接' }));
  expect(await screen.findByText('公司模型 连接成功')).toBeInTheDocument();
  expect(invokeMock).toHaveBeenCalledWith('model_profile_test', { profileId: 'profile-1' });

  await userEvent.click(screen.getByRole('button', { name: '删除' }));
  expect(invokeMock).toHaveBeenCalledWith('model_profile_delete', { profileId: 'profile-1' });
});
