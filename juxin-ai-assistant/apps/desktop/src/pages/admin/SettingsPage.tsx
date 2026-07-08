import { useState } from 'react';

import { governanceApi } from '../../api/governance';
import { AdminPageState, RequestNotice } from './AdminPageState';

const SETTING_FIELDS = [
  ['global_safety_notice', '全局安全提示'],
  ['history_retention_days', '历史保留天数'],
  ['knowledge_limit', '知识引用上限'],
  ['default_temperature', '默认温度'],
  ['support_contact', '支持联系人'],
] as const;

export function SettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const load = async () => {
    try {
      const payload = await governanceApi.settings();
      setValues(Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, String(value)])));
      setNotice('已加载当前设置。');
    } catch { setNotice('设置读取失败，请确认治理权限。'); }
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await governanceApi.saveSettings({
        ...values,
        ...(values.history_retention_days ? { history_retention_days: Number(values.history_retention_days) } : {}),
        ...(values.knowledge_limit ? { knowledge_limit: Number(values.knowledge_limit) } : {}),
        ...(values.default_temperature ? { default_temperature: Number(values.default_temperature) } : {}),
        ...(values.sensitive_detection_enabled ? { sensitive_detection_enabled: values.sensitive_detection_enabled === 'true' } : {}),
      });
      setNotice('设置已保存。');
    } catch { setNotice('设置保存失败，服务端拒绝了无效值。'); }
  };
  return (
    <AdminPageState title="系统设置" description="仅开放经过审核的非敏感运行参数。">
      <button className="secondary-action" onClick={() => void load()} type="button">加载当前设置</button>
      <form className="settings-form" onSubmit={(event) => void save(event)}>
        {SETTING_FIELDS.map(([key, label]) => (
          <label key={key}>{label}<input value={values[key] || ''} onChange={(event) => setValues({ ...values, [key]: event.target.value })} /></label>
        ))}
        <label className="toggle-setting"><input checked={values.sensitive_detection_enabled !== 'false'} onChange={(event) => setValues({ ...values, sensitive_detection_enabled: String(event.target.checked) })} type="checkbox" />启用敏感信息检测</label>
        <button className="primary-action" type="submit">保存设置</button>
      </form>
      <RequestNotice message={notice} />
    </AdminPageState>
  );
}
