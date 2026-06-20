import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';

import { DynamicTaskForm } from '../src/components/DynamicTaskForm';
import type { TaskFieldPayload } from '../src/api/client';

it('renders every catalog field type and never creates a fake file value', async () => {
  const fields: TaskFieldPayload[] = [
    { field_key: 'title', label: '标题', field_type: 'TEXT', required: true, options: [], validation: {} },
    { field_key: 'content', label: '正文', field_type: 'TEXTAREA', required: false, options: [], validation: {} },
    { field_key: 'tone', label: '语气', field_type: 'SELECT', required: false, options: ['正式'], validation: {} },
    { field_key: 'tags', label: '标签', field_type: 'MULTISELECT', required: false, options: ['重要', '紧急'], validation: {} },
    { field_key: 'date', label: '日期', field_type: 'DATE', required: false, options: [], validation: {} },
    { field_key: 'count', label: '数量', field_type: 'NUMBER', required: false, options: [], validation: {} },
    { field_key: 'public', label: '公开', field_type: 'SWITCH', required: false, options: [], validation: {} },
    { field_key: 'attachment', label: '附件', field_type: 'FILE_RESERVED', required: false, options: [], validation: {} },
  ];
  const onChange = vi.fn();

  function Harness() {
    const [values, setValues] = useState<Record<string, unknown>>({});
    return (
      <DynamicTaskForm
        fields={fields}
        onChange={(key, value) => {
          onChange(key, value);
          setValues((current) => ({ ...current, [key]: value }));
        }}
        values={values}
      />
    );
  }

  render(<Harness />);

  await userEvent.type(screen.getByLabelText('标题'), '周报');
  await userEvent.selectOptions(screen.getByLabelText('标签'), ['重要', '紧急']);
  expect(screen.getByText('文件解析将在后续版本启用，请先粘贴文本内容')).toBeInTheDocument();
  expect(screen.queryByLabelText('附件')).not.toBeInTheDocument();
  expect(onChange).toHaveBeenCalledWith('title', '周报');
  expect(onChange).toHaveBeenCalledWith('tags', ['重要', '紧急']);
});
