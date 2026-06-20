import type { TaskFieldPayload } from '../api/client';

export type DynamicFieldDefinition = Omit<
  TaskFieldPayload,
  'options' | 'validation'
> & {
  options?: string[];
  validation?: Record<string, unknown>;
};

type DynamicTaskFormProps = {
  fields: DynamicFieldDefinition[];
  onChange: (fieldKey: string, value: unknown) => void;
  values: Record<string, unknown>;
};

export function DynamicTaskForm({ fields, onChange, values }: DynamicTaskFormProps) {
  return fields.map((field) => {
    const value = values[field.field_key];
    if (field.field_type === 'FILE_RESERVED') {
      return (
        <div className="dynamic-field reserved-file-field" key={field.field_key}>
          <span>{field.label}</span>
          <div aria-disabled="true">
            <strong>暂不支持文件解析</strong>
            <small>文件解析将在后续版本启用，请先粘贴文本内容</small>
          </div>
        </div>
      );
    }

    return (
      <label className="dynamic-field" key={field.field_key}>
        <span>{field.label}{field.required ? ' *' : ''}</span>
        {field.field_type === 'TEXTAREA' ? (
          <textarea
            aria-label={field.label}
            onChange={(event) => onChange(field.field_key, event.target.value)}
            placeholder={field.placeholder}
            rows={8}
            value={String(value ?? '')}
          />
        ) : field.field_type === 'SELECT' ? (
          <select
            aria-label={field.label}
            onChange={(event) => onChange(field.field_key, event.target.value)}
            value={String(value ?? '')}
          >
            <option value="">请选择</option>
            {field.options?.map((option) => <option key={option}>{option}</option>)}
          </select>
        ) : field.field_type === 'MULTISELECT' ? (
          <select
            aria-label={field.label}
            multiple
            onChange={(event) => onChange(
              field.field_key,
              Array.from(event.target.selectedOptions, (option) => option.value),
            )}
            value={Array.isArray(value) ? value.map(String) : []}
          >
            {field.options?.map((option) => <option key={option}>{option}</option>)}
          </select>
        ) : field.field_type === 'SWITCH' ? (
          <input
            aria-label={field.label}
            checked={Boolean(value)}
            onChange={(event) => onChange(field.field_key, event.target.checked)}
            type="checkbox"
          />
        ) : (
          <input
            aria-label={field.label}
            onChange={(event) => onChange(
              field.field_key,
              field.field_type === 'NUMBER'
                ? event.target.value === '' ? '' : Number(event.target.value)
                : event.target.value,
            )}
            placeholder={field.placeholder}
            type={field.field_type === 'DATE' ? 'date' : field.field_type === 'NUMBER' ? 'number' : 'text'}
            value={String(value ?? '')}
          />
        )}
      </label>
    );
  });
}
