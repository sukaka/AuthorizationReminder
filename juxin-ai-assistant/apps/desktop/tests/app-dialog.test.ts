import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';

import { confirmAppDialog, promptAppDialog } from '../src/components/appDialog';

it('confirms a dangerous action and restores the previous focus', async () => {
  const trigger = document.createElement('button');
  trigger.textContent = '删除';
  document.body.append(trigger);
  trigger.focus();

  const result = confirmAppDialog({
    title: '删除资料',
    message: '删除后不可恢复。',
    confirmLabel: '确认删除',
    danger: true,
  });

  const dialog = await screen.findByRole('dialog', { name: '删除资料' });
  expect(dialog).toHaveTextContent('删除后不可恢复。');
  await userEvent.click(screen.getByRole('button', { name: '确认删除' }));

  await expect(result).resolves.toBe(true);
  expect(trigger).toHaveFocus();
  trigger.remove();
});

it('collects multiline input and cancels with Escape', async () => {
  const submitted = promptAppDialog({
    title: '修正方式',
    initialValue: '原内容',
    multiline: true,
  });
  const field = await screen.findByRole('textbox', { name: '修正方式' });
  await userEvent.clear(field);
  await userEvent.type(field, '新的修正方式');
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  await expect(submitted).resolves.toBe('新的修正方式');

  const cancelled = promptAppDialog({ title: '模板名称' });
  const dialog = await screen.findByRole('dialog', { name: '模板名称' });
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  await expect(cancelled).resolves.toBeNull();
});
