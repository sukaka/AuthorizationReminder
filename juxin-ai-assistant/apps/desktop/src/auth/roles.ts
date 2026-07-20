const PLATFORM_ADMIN_ROLES = new Set(['admin', 'superadmin', 'sys_admin', 'platform_admin']);

export function isPlatformAdminRole(role: string | null | undefined): boolean {
  return PLATFORM_ADMIN_ROLES.has((role || '').trim().toLowerCase());
}
