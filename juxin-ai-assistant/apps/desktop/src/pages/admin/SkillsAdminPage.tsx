import { useEffect, useState } from 'react';

import { governanceApi, type AdminSkill } from '../../api/governance';
import { AdminPageState, RequestNotice } from './AdminPageState';

function permissionLabel(skill: AdminSkill): string {
  return [
    `联网：${skill.permissions.allow_web ? '开启' : '关闭'}`,
    `公司知识：${skill.permissions.allow_company_knowledge ? '开启' : '关闭'}`,
    `写公司知识库：${skill.permissions.allow_write_company_kb ? '开启' : '关闭'}`,
  ].join(' · ');
}

export function SkillsAdminPage() {
  const [items, setItems] = useState<AdminSkill[]>([]);
  const [notice, setNotice] = useState('');
  const [uploading, setUploading] = useState(false);

  const refresh = async () => {
    setNotice('正在读取能力配置…');
    try {
      const payload = await governanceApi.skills();
      setItems(payload.items);
      setNotice(payload.items.length ? '' : '暂无能力配置');
    } catch {
      setNotice('能力配置读取失败，请确认治理权限。');
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const review = async (skill: AdminSkill) => {
    try {
      await governanceApi.reviewSkill(skill.id, 'approved', '通过');
      setNotice(`已审核：${skill.id}`);
    } catch {
      setNotice(`审核失败：${skill.id}`);
    }
  };

  const publish = async (skill: AdminSkill) => {
    const updated = await governanceApi.publishSkill(skill.id);
    setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
    setNotice(`已发布：${skill.id}`);
  };

  const disable = async (skill: AdminSkill) => {
    const updated = await governanceApi.disableSkill(skill.id);
    setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
    setNotice(`已停用：${skill.id}`);
  };

  const upload = async (file: File) => {
    setUploading(true);
    setNotice('正在校验并上传系统通用 Skill…');
    try {
      const uploaded = await governanceApi.uploadSkill(file);
      setItems((current) => [uploaded, ...current.filter((item) => item.id !== uploaded.id)]);
      setNotice(`已上传“${uploaded.name}”，请审核后再发布。`);
    } catch {
      setNotice('Skill 上传失败：请上传包含完整目录结构的 ZIP 压缩包。');
    } finally {
      setUploading(false);
    }
  };

  return (
    <AdminPageState title="能力治理" description="查看公司级能力版本、工具边界、权限边界与审核状态。">
      <div className="admin-toolbar">
        <button className="primary-action" onClick={() => void refresh()} type="button">刷新能力</button>
        <span>公司级能力发布前需要管理员审核。</span>
        <label className="primary-action">
          {uploading ? '上传中…' : '上传系统通用 Skill'}
          <input
            accept=".zip,application/zip"
            disabled={uploading}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void upload(file);
            }}
            type="file"
            hidden
          />
        </label>
      </div>
      <RequestNotice message={notice} />
      <div className="task-card-list">
        {items.map((skill) => (
          <article aria-label={skill.id} className="history-card" key={skill.id}>
            <span className="knowledge-source-badge">{skill.scope}</span>
            <h2>{skill.name}</h2>
            <p>{skill.id}</p>
            <p>{skill.version} · {skill.status}</p>
            <p>{skill.description}</p>
            <p>{skill.allowed_tools.join('、')}</p>
            <p>{permissionLabel(skill)}</p>
            <p>审核：{skill.review.required_for_publish ? `需要 ${skill.review.reviewer_role}` : '不需要'}</p>
            <div className="history-actions">
              <button aria-label={`审核通过 ${skill.id}`} onClick={() => void review(skill)} type="button">
                审核通过
              </button>
              <button aria-label={`发布 ${skill.id}`} onClick={() => void publish(skill)} type="button">
                发布
              </button>
              <button aria-label={`停用 ${skill.id}`} onClick={() => void disable(skill)} type="button">
                停用
              </button>
            </div>
          </article>
        ))}
      </div>
    </AdminPageState>
  );
}
