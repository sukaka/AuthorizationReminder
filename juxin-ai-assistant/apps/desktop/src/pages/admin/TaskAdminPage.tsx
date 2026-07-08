import { useState } from 'react';

import { governanceApi, type AdminTask, type AdminTaskField, type TaskCapability } from '../../api/governance';
import { AdminPageState, RequestNotice } from './AdminPageState';

export const SUPPORTED_FIELD_TYPES = [
  'TEXT', 'TEXTAREA', 'SELECT', 'MULTISELECT', 'DATE', 'NUMBER', 'SWITCH', 'FILE_RESERVED',
] as const;

export function TaskAdminPage() {
  const [items, setItems] = useState<AdminTask[]>([]);
  const [selected, setSelected] = useState<AdminTask | null>(null);
  const [notice, setNotice] = useState('');
  const [status, setStatus] = useState<AdminTask['status']>('DRAFT');
  const [promptId, setPromptId] = useState(0);
  const [promptVersion, setPromptVersion] = useState(1);
  const [versionPolicy, setVersionPolicy] = useState<'PUBLISHED' | 'PINNED'>('PUBLISHED');
  const [fields, setFields] = useState<AdminTaskField[]>([]);
  const [capabilities, setCapabilities] = useState<TaskCapability[]>([]);
  const [newTask, setNewTask] = useState({ assistant_uuid: '', code: '', name: '' });

  const selectTask = (item: AdminTask) => {
    setSelected(item);
    setStatus(item.status);
    setPromptId(item.prompt_binding?.prompt_external_id || 0);
    setVersionPolicy(item.prompt_binding?.version_policy || 'PUBLISHED');
    setPromptVersion(item.prompt_binding?.pinned_version || 1);
    setFields(item.fields || []);
    setNotice('');
  };

  const refresh = async () => {
    setNotice('正在读取任务…');
    try {
      const [payload, capabilityPayload] = await Promise.all([
        governanceApi.tasks(),
        governanceApi.capabilities(),
      ]);
      setItems(payload.items);
      setCapabilities(capabilityPayload.items);
      setNotice(payload.items.length ? '' : '暂无任务');
    } catch {
      setNotice('无法读取任务，请确认治理权限。');
    }
  };

  const updateField = (index: number, patch: Partial<AdminTaskField>) => {
    setFields((current) => current.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...patch } : field));
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setNotice('正在验证并保存…');
    try {
      await governanceApi.saveTaskConfiguration(selected.uuid, {
        task: { status },
        fields,
        prompt_binding: {
          prompt_external_id: promptId,
          version_policy: versionPolicy,
          ...(versionPolicy === 'PINNED' ? { pinned_version: promptVersion } : {}),
          status: 'ACTIVE',
        },
      });
      setNotice('任务、字段和内容模板绑定已保存。');
    } catch { setNotice('保存失败；激活任务必须绑定已发布内容模板，且字段键必须唯一有效。'); }
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await governanceApi.createTask({ ...newTask, status: 'DRAFT' });
      setNewTask({ assistant_uuid: '', code: '', name: '' });
      setNotice('草稿任务已创建。');
      await refresh();
    } catch { setNotice('创建失败；任务代码必须唯一并符合命名规则。'); }
  };

  const remove = async () => {
    if (!selected) return;
    try {
      await governanceApi.deleteTask(selected.uuid);
      setSelected(null);
      setNotice('未启用草稿已删除。');
      await refresh();
    } catch { setNotice('只能删除从未启用且没有生成记录的草稿；请改为停用。'); }
  };

  const promptBindingLabel = (status: TaskCapability['prompt_binding_status']) => {
    if (status === 'configured') return '内容模板已配置';
    if (status === 'missing') return '内容模板缺失';
    return '内容模板需检查';
  };

  return (
    <AdminPageState title="任务管理" description="维护任务状态、字段结构与已发布内容模板的绑定关系。">
      <div className="admin-toolbar">
        <button className="primary-action" onClick={() => void refresh()} type="button">刷新任务</button>
        <span>激活前会由服务端验证内容模板已发布版本。</span>
      </div>
      <form className="inline-create" onSubmit={(event) => void create(event)}>
        <label>助手 UUID<input required value={newTask.assistant_uuid} onChange={(event) => setNewTask({ ...newTask, assistant_uuid: event.target.value })} /></label>
        <label>任务代码<input required pattern="[a-z][a-z0-9_-]{1,95}" value={newTask.code} onChange={(event) => setNewTask({ ...newTask, code: event.target.value })} /></label>
        <label>任务名称<input required value={newTask.name} onChange={(event) => setNewTask({ ...newTask, name: event.target.value })} /></label>
        <button className="secondary-action" type="submit">新建草稿</button>
      </form>
      <RequestNotice message={notice} />
      {capabilities.length ? (
        <section className="capability-health" aria-label="能力健康">
          <h2>能力健康</h2>
          <div className="task-card-list compact">
            {capabilities.map((capability) => (
              <article key={capability.task_uuid}>
                <strong>{capability.task_name}</strong>
                <span>{capability.assistant_name} · {capability.output_format}</span>
                <small>{promptBindingLabel(capability.prompt_binding_status)}</small>
                <small>
                  字段 {capability.input_fields.length} 个 · 知识 {capability.knowledge_link_count} 条 · {capability.task_status}
                </small>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <div className="governance-split">
        <div className="governance-list" aria-label="任务列表">
          {items.map((item) => (
            <button key={item.uuid} onClick={() => selectTask(item)} type="button">
              <strong>{item.name}</strong><span>{item.code} · {item.status}</span>
            </button>
          ))}
        </div>
        <form className="governance-editor" onSubmit={(event) => void save(event)}>
          <h2>{selected?.name || '选择任务进行编辑'}</h2>
          <label>状态<select disabled={!selected} value={status} onChange={(event) => setStatus(event.target.value as AdminTask['status'])}><option>DRAFT</option><option>ACTIVE</option><option>DISABLED</option></select></label>
          <label>内容模板 ID<input disabled={!selected} min="1" type="number" value={promptId || ''} onChange={(event) => setPromptId(Number(event.target.value))} /></label>
          <label>版本策略<select disabled={!selected} value={versionPolicy} onChange={(event) => setVersionPolicy(event.target.value as 'PUBLISHED' | 'PINNED')}><option value="PUBLISHED">跟随已发布版本</option><option value="PINNED">固定版本</option></select></label>
          {versionPolicy === 'PINNED' ? <label>固定版本<input disabled={!selected} min="1" type="number" value={promptVersion} onChange={(event) => setPromptVersion(Number(event.target.value))} /></label> : null}
          <div className="field-editor">
            <div><strong>动态字段</strong><button disabled={!selected} onClick={() => setFields((current) => [...current, { field_key: '', label: '', field_type: 'TEXT', required: false }])} type="button">新增字段</button></div>
            {fields.map((field, index) => (
              <fieldset key={`${field.field_key}-${index}`}>
                <label>字段键<input required value={field.field_key} onChange={(event) => updateField(index, { field_key: event.target.value })} /></label>
                <label>显示名<input required value={field.label} onChange={(event) => updateField(index, { label: event.target.value })} /></label>
                <label>类型<select value={field.field_type} onChange={(event) => updateField(index, { field_type: event.target.value })}>{SUPPORTED_FIELD_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
                <label>占位提示<input value={field.placeholder || ''} onChange={(event) => updateField(index, { placeholder: event.target.value })} /></label>
                <label>选项<input placeholder="逗号分隔" value={(field.options || []).join(', ')} onChange={(event) => updateField(index, { options: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} /></label>
                <label className="field-required"><input checked={field.required} onChange={(event) => updateField(index, { required: event.target.checked })} type="checkbox" />必填</label>
                <button aria-label={`删除字段 ${field.label || index + 1}`} onClick={() => setFields((current) => current.filter((_, fieldIndex) => fieldIndex !== index))} type="button">删除</button>
              </fieldset>
            ))}
          </div>
          <button className="primary-action" disabled={!selected} type="submit">保存并验证</button>
          {selected ? <button className="danger-action" onClick={() => void remove()} type="button">删除草稿</button> : null}
        </form>
      </div>
    </AdminPageState>
  );
}
