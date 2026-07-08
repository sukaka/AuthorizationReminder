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

const vaguePlaceholderPattern = /^(请)?(填写|粘贴|输入|请填写|请粘贴|请输入)(一下|相关|具体|完整|详细)?/;

function normalizeText(value: string) {
  return value
    .replace(/[【】[\]（）()：:，,。.!！?？\s]/g, '')
    .replace(/^(请)?(填写|粘贴|输入|请填写|请粘贴|请输入)/, '');
}

function stripPlaceholderWrapper(value: string) {
  return value.trim().replace(/^【(.+)】$/, '$1').replace(/^\[(.+)\]$/, '$1').trim();
}

function isPlaceholderUnclear(label: string, placeholder = '') {
  const cleanPlaceholder = stripPlaceholderWrapper(placeholder);
  if (!cleanPlaceholder) return true;
  if (/^(例如|示例|可写|可填|可粘贴|格式|多个|逗号|换行|写清|写明)/.test(cleanPlaceholder)) return false;
  if (cleanPlaceholder.length <= 4 && vaguePlaceholderPattern.test(cleanPlaceholder)) return true;

  const normalizedLabel = normalizeText(label);
  const normalizedPlaceholder = normalizeText(cleanPlaceholder);
  if (!normalizedPlaceholder) return true;
  return normalizedPlaceholder === normalizedLabel
    || normalizedPlaceholder.endsWith(normalizedLabel)
    || (vaguePlaceholderPattern.test(cleanPlaceholder) && cleanPlaceholder.length <= label.length + 10);
}

export function getFieldWritingHint(field: DynamicFieldDefinition) {
  const label = field.label;
  if (field.field_type === 'SELECT') return '请选择最接近的选项；不确定时可先留空。';
  if (field.field_type === 'MULTISELECT') return '可多选；只选与本次任务真正相关的项。';
  if (field.field_type === 'SWITCH') return '打开表示“是/需要/启用”，关闭表示“否/不需要”。';
  if (field.field_type === 'NUMBER') return '请输入数字；范围或口径不确定时可在备注类字段补充说明。';
  if (field.field_type === 'DATE') return '请选择日期；没有准确日期时可在相关说明中写“待确认”。';
  if (/正文|原文|内容|记录|日志|清单|说明|材料|参数|标书|需求|问题|事项/.test(label)) {
    return '可粘贴原文或分条写要点；不确定处写“待确认”。';
  }
  return '补充已知事实、背景、目标和限制条件；不确定处写“待确认”。';
}

export function getFieldPlaceholder(field: DynamicFieldDefinition) {
  if (!isPlaceholderUnclear(field.label, field.placeholder)) {
    return stripPlaceholderWrapper(field.placeholder ?? '');
  }

  if (field.field_type === 'TEXTAREA') {
    return /正文|原文|内容|记录|日志|清单|材料|参数|标书|需求/.test(field.label)
      ? '可粘贴原文，或按要点分段说明'
      : '写清背景、目标、限制条件和期望结果';
  }
  if (field.field_type === 'NUMBER') return '例如：3';
  if (field.field_type === 'DATE') return '';
  if (/时间/.test(field.label)) return '例如：本周五上午、2026-06-26 14:00';
  if (/客户/.test(field.label)) return '例如：客户简称或已脱敏名称';
  if (/项目/.test(field.label)) return '例如：项目简称、阶段或交付范围';
  if (/IP|域名|端口/i.test(field.label)) return '例如：10.0.0.1、example.com 或 443';
  if (/是否|需不需要|要不要/.test(field.label)) return '写明是/否，以及已知前提';
  return '可写具体信息；不确定处写“待确认”';
}

export function DynamicTaskForm({ fields, onChange, values }: DynamicTaskFormProps) {
  return fields.map((field) => {
    const value = values[field.field_key];
    const writingHint = getFieldWritingHint(field);
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
            placeholder={getFieldPlaceholder(field)}
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
            placeholder={getFieldPlaceholder(field)}
            type={field.field_type === 'DATE' ? 'date' : field.field_type === 'NUMBER' ? 'number' : 'text'}
            value={String(value ?? '')}
          />
        )}
        <small className="field-guidance">{writingHint}</small>
      </label>
    );
  });
}
