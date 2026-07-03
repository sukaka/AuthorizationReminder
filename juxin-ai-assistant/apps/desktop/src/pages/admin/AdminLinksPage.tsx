import { AdminPageState } from './AdminPageState';

export type AdminCenterUrls = { adminCenter: string; promptCenter: string };

export function getAdminCenterUrls(): AdminCenterUrls {
  return {
    adminCenter: import.meta.env.VITE_ADMIN_CENTER_URL || 'http://localhost:5180/admin-center',
    promptCenter: import.meta.env.VITE_PROMPT_CENTER_URL || 'http://localhost:18088',
  };
}

export function AdminLinksPage({ urls = getAdminCenterUrls() }: { urls?: AdminCenterUrls }) {
  return (
    <AdminPageState title="管理入口" description="账号与内容模板继续由现有平台统一管理。">
      <div className="governance-links">
        <a aria-label="打开统一用户管理" href={urls.adminCenter} rel="noreferrer" target="_blank">
          <strong>统一用户管理</strong>
          <span>组织、账号与应用权限</span>
          <em>打开统一用户管理</em>
        </a>
        <a aria-label="打开内容模板管理中心" href={urls.promptCenter} rel="noreferrer" target="_blank">
          <strong>内容模板管理中心</strong>
          <span>模板发布与版本追踪</span>
          <em>打开内容模板管理中心</em>
        </a>
      </div>
    </AdminPageState>
  );
}
