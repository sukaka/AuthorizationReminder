import { useEffect, useState } from 'react';

import {
  governanceApi,
  type AssistantMode,
  type AssistantModeInput,
} from '../../api/governance';
import { AdminPageState, RequestNotice } from './AdminPageState';

const TOOLS = [
  ['company_knowledge_search', '公司资料检索'],
  ['current_attachment_search', '本次附件检索'],
  ['document_structure_validate', '文档结构检查'],
  ['document_template_select', '选择文档模板'],
  ['file_parse', '解析附件'],
  ['personal_memory', '个人记忆'],
  ['personal_reference_search', '个人资料检索'],
  ['reference_source_validate', '来源检查'],
  ['web_research', '联网调研'],
  ['web_search', '联网搜索'],
  ['word_export', '导出 Word'],
  ['pptx_export', '导出演示文稿'],
] as const;

const EMPTY_MODE: AssistantModeInput = {
  code: '',
  name: '',
  description: '',
  icon: 'sparkles',
  allowed_tools: [],
  default_source_scope: 'company',
  default_output_structure: '',
  word_template: 'juxin_standard',
  test_cases: [],
  review_status: 'draft',
};

function toInput(mode: AssistantMode): AssistantModeInput {
  return {
    code: mode.code,
    name: mode.name,
    description: mode.description,
    icon: mode.icon,
    allowed_tools: mode.allowed_tools,
    default_source_scope: mode.default_source_scope,
    default_output_structure: mode.default_output_structure,
    word_template: mode.word_template,
    test_cases: mode.test_cases,
    review_status: mode.review_status,
  };
}

export function AssistantModesAdminPage() {
  const [items, setItems] = useState<AssistantMode[]>([]);
  const [selected, setSelected] = useState<AssistantMode | null>(null);
  const [draft, setDraft] = useState<AssistantModeInput>(EMPTY_MODE);
  const [testInput, setTestInput] = useState('');
  const [rollbackVersion, setRollbackVersion] = useState(1);
  const [notice, setNotice] = useState('');

  const choose = (mode: AssistantMode) => {
    setSelected(mode);
    setDraft(toInput(mode));
    setRollbackVersion(mode.available_versions[0] || mode.version);
    setNotice('');
  };

  const refresh = async () => {
    setNotice('正在读取助手模式…');
    try {
      const payload = await governanceApi.assistantModes();
      setItems(payload.items);
      if (payload.items[0]) choose(payload.items[0]);
      else setNotice('暂无助手模式');
    } catch {
      setNotice('助手模式读取失败，请确认治理权限。');
    }
  };

  useEffect(() => { void refresh(); }, []);

  const replaceMode = (updated: AssistantMode) => {
    setItems((current) => {
      const exists = current.some((item) => item.uuid === updated.uuid);
      return exists
        ? current.map((item) => item.uuid === updated.uuid ? updated : item)
        : [...current, updated];
    });
    choose(updated);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const updated = selected
        ? await governanceApi.saveAssistantMode(selected.uuid, draft)
        : await governanceApi.createAssistantMode(draft);
      replaceMode(updated);
      setNotice(selected ? '助手模式已保存。' : '助手模式草稿已创建。');
    } catch {
      setNotice('保存失败，请检查模式编码、审核状态与配置内容。');
    }
  };

  const toggleTool = (tool: string, enabled: boolean) => {
    setDraft((current) => ({
      ...current,
      allowed_tools: enabled
        ? [...current.allowed_tools, tool]
        : current.allowed_tools.filter((item) => item !== tool),
    }));
  };

  const test = async () => {
    if (!selected) return;
    try {
      const result = await governanceApi.testAssistantMode(selected.uuid, testInput);
      setNotice(result.status === 'passed'
        ? '试运行通过，未写入正式任务或工作成果。'
        : `试运行未通过：${result.issues.join('；')}`);
    } catch {
      setNotice('试运行失败，请稍后重试。');
    }
  };

  const changeStatus = async () => {
    if (!selected) return;
    try {
      const updated = await governanceApi.setAssistantModeEnabled(
        selected.uuid,
        selected.status !== 'ACTIVE',
      );
      replaceMode(updated);
      setNotice(updated.status === 'ACTIVE' ? '助手模式已启用。' : '助手模式已停用。');
    } catch {
      setNotice('状态修改失败；启用前需完成审核。');
    }
  };

  const rollback = async () => {
    if (!selected) return;
    try {
      const updated = await governanceApi.rollbackAssistantMode(selected.uuid, rollbackVersion);
      replaceMode(updated);
      setNotice(`已回滚到版本 ${rollbackVersion}，并生成新版本。`);
    } catch {
      setNotice('回滚失败，请确认所选版本仍然存在。');
    }
  };

  return (
    <AdminPageState title="助手模式治理" description="配置助手可使用的资料、工具、输出结构与文档模板。">
      <div aria-label="模式操作" className="admin-toolbar" role="group">
        <button className="primary-action" onClick={() => { setSelected(null); setDraft(EMPTY_MODE); setNotice(''); }} type="button">新建模式</button>
        <button onClick={() => void refresh()} type="button">刷新</button>
      </div>
      <RequestNotice message={notice} />
      <div className="governance-split">
        <div aria-label="助手模式列表" className="governance-list">
          {items.map((mode) => (
            <button key={mode.uuid} onClick={() => choose(mode)} type="button">
              <strong>{mode.name}</strong>
              <span>{mode.status} · v{mode.version} · 失败率 {(mode.failure_rate * 100).toFixed(1)}%</span>
            </button>
          ))}
        </div>
        <form className="governance-editor" onSubmit={(event) => void save(event)}>
          <h2>{selected?.name || '新建助手模式'}</h2>
          <label>模式编码<input disabled={Boolean(selected)} required value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} /></label>
          <label>名称<input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label>说明<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
          <label>默认资料范围<select aria-label="默认资料范围" value={draft.default_source_scope} onChange={(event) => setDraft({ ...draft, default_source_scope: event.target.value as AssistantModeInput['default_source_scope'] })}>
            <option value="none">不预设</option><option value="company">公司资料</option><option value="personal">个人资料</option><option value="session">本次附件</option><option value="company_and_personal">公司与个人资料</option>
          </select></label>
          <fieldset className="assistant-mode-tools">
            <legend>允许使用的工具</legend>
            {TOOLS.map(([value, label]) => <label key={value}><input checked={draft.allowed_tools.includes(value)} onChange={(event) => toggleTool(value, event.target.checked)} type="checkbox" />{label}</label>)}
          </fieldset>
          <label>默认输出结构<textarea required value={draft.default_output_structure} onChange={(event) => setDraft({ ...draft, default_output_structure: event.target.value })} /></label>
          <label>Word 模板<select value={draft.word_template} onChange={(event) => setDraft({ ...draft, word_template: event.target.value })}><option value="juxin_standard">聚信标准模板</option><option value="security_report">安全报告模板</option><option value="meeting_minutes">会议纪要模板</option></select></label>
          <label>配置测试样例<textarea value={draft.test_cases[0]?.input || ''} onChange={(event) => setDraft({ ...draft, test_cases: event.target.value ? [{ name: '默认样例', input: event.target.value }] : [] })} /></label>
          <label>审核状态<select value={draft.review_status} onChange={(event) => setDraft({ ...draft, review_status: event.target.value as AssistantModeInput['review_status'] })}><option value="draft">草稿</option><option value="pending">待审核</option><option value="approved">已通过</option><option value="rejected">已退回</option></select></label>
          <button className="primary-action" type="submit">保存模式</button>
          {selected ? <>
            <label>试运行输入<textarea value={testInput} onChange={(event) => setTestInput(event.target.value)} /></label>
            <button onClick={() => void test()} type="button">试运行</button>
            <button onClick={() => void changeStatus()} type="button">{selected.status === 'ACTIVE' ? '停用模式' : '启用模式'}</button>
            <label>历史版本<select aria-label="历史版本" value={rollbackVersion} onChange={(event) => setRollbackVersion(Number(event.target.value))}>{selected.available_versions.map((version) => <option key={version} value={version}>版本 {version}</option>)}</select></label>
            <button onClick={() => void rollback()} type="button">回滚版本</button>
          </> : null}
        </form>
      </div>
    </AdminPageState>
  );
}
