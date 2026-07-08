const { resolveUserAppAccess } = require('./portal-routing');

const allow = () => ({ allow: true });
const deny = (reason) => ({ allow: false, reason });

const authorizeBigScreen = (user, action) => {
  if (!user) return deny('未登录');
  if (!resolveUserAppAccess(user).includes('big-screen')) {
    return deny('无权限访问统一大屏展示中心');
  }

  const role = String(user.role || '').toLowerCase();
  if (action === 'app:enter' || action === 'catalog:read' || action === 'screen:play') {
    return allow();
  }
  if (action === 'playlist:write' && ['admin', 'editor', 'reviewer'].includes(role)) {
    return allow();
  }
  if ((action === 'template:draft' || action === 'template:publish') && ['admin', 'editor'].includes(role)) {
    return allow();
  }
  if (action === 'source:admin' && role === 'admin') {
    return allow();
  }
  return deny('当前角色无权执行该大屏操作');
};

module.exports = { authorizeBigScreen };
