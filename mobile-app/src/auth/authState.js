const ANONYMOUS_AUTH_STATE = {
  status: 'anonymous',
  token: '',
  user: null,
  error: '',
};

export const createInitialAuthState = () => ({
  status: 'checking',
  token: '',
  user: null,
  error: '',
});

const createAnonymousAuthState = (error = '') => ({
  ...ANONYMOUS_AUTH_STATE,
  error,
});

export const authReducer = (state = createInitialAuthState(), action = {}) => {
  switch (action.type) {
    case 'checking':
      return {
        ...state,
        status: 'checking',
        error: '',
      };
    case 'anonymous':
      return createAnonymousAuthState();
    case 'loginStart':
      return {
        ...state,
        status: 'authenticating',
        error: '',
      };
    case 'loginSuccess':
      return {
        status: 'authenticated',
        token: typeof action.token === 'string' ? action.token : '',
        user: action.user || null,
        error: '',
      };
    case 'loginFailure':
      return createAnonymousAuthState(action.error || '登录失败');
    case 'logout':
      return createAnonymousAuthState();
    default:
      return state;
  }
};

export const isUserAllowedForSystem = (user, systemKey) => {
  if (!user) {
    return false;
  }

  if (String(user.role || '').trim().toLowerCase() === 'admin') {
    return true;
  }

  return typeof systemKey === 'string'
    && Array.isArray(user.app_access)
    && user.app_access.includes(systemKey);
};
