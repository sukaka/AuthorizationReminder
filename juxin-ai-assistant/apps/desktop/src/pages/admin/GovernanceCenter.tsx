import { useState } from 'react';

import type { SessionPayload } from '../../api/client';
import { AdminLinksPage } from './AdminLinksPage';
import { AuditPage } from './AuditPage';
import { DesktopUpdatesPage } from './DesktopUpdatesPage';
import { KnowledgeAdminPage } from './KnowledgeAdminPage';
import { SettingsPage } from './SettingsPage';
import { StatsPage } from './StatsPage';
import { SuggestionsPage } from './SuggestionsPage';
import { TaskAdminPage } from './TaskAdminPage';

type GovernancePage = 'tasks' | 'knowledge' | 'suggestions' | 'stats' | 'audit' | 'settings' | 'links' | 'desktop-updates';

const ITEMS: Array<{ page: GovernancePage; label: string }> = [
  { page: 'tasks', label: '任务管理' },
  { page: 'knowledge', label: '知识库' },
  { page: 'suggestions', label: '建议审核' },
  { page: 'stats', label: '全局统计' },
  { page: 'audit', label: '审计日志' },
  { page: 'settings', label: '系统设置' },
  { page: 'desktop-updates', label: '桌面端更新' },
  { page: 'links', label: '管理入口' },
];

export function GovernanceCenter({ session }: { session: SessionPayload }) {
  const [page, setPage] = useState<GovernancePage>('tasks');
  const items = session.user.role.trim().toLowerCase() === 'admin'
    ? ITEMS
    : ITEMS.filter((item) => item.page !== 'audit' && item.page !== 'desktop-updates');
  return (
    <div className="governance-shell">
      <nav aria-label="治理导航" className="governance-nav">
        {items.map((item) => (
          <button aria-current={page === item.page ? 'page' : undefined} className={page === item.page ? 'is-current' : ''} key={item.page} onClick={() => setPage(item.page)} type="button">
            {item.label}
          </button>
        ))}
      </nav>
      {page === 'tasks' ? <TaskAdminPage />
        : page === 'knowledge' ? <KnowledgeAdminPage />
          : page === 'suggestions' ? <SuggestionsPage admin departments={session.scope.managedDepartments} />
            : page === 'stats' ? <StatsPage />
              : page === 'audit' ? <AuditPage />
                : page === 'settings' ? <SettingsPage />
                  : page === 'desktop-updates' ? <DesktopUpdatesPage />
                    : <AdminLinksPage />}
    </div>
  );
}
