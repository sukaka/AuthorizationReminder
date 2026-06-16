const ANONYMOUS_AUTH_STATE = {
  status: 'anonymous',
  token: '',
  user: null,
  error: '',
};
const INVALID_AUTH_STATE_ERROR = '登录状态无效，请重新登录';
const DEFAULT_LOGIN_FAILURE_ERROR = '登录失败';

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

const isPlainUserObject = (user) => (
  user !== null
  && typeof user === 'object'
  && !Array.isArray(user)
);

const normalizeErrorMessage = (value, defaultMessage = DEFAULT_LOGIN_FAILURE_ERROR) => {
  if (typeof value === 'string') {
    return value.trim() || defaultMessage;
  }

  if (value instanceof Error) {
    return normalizeErrorMessage(value.message, defaultMessage);
  }

  return defaultMessage;
};

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
    case 'loginSuccess': {
      const token = typeof action.token === 'string' ? action.token.trim() : '';

      if (!token || !isPlainUserObject(action.user)) {
        return createAnonymousAuthState(INVALID_AUTH_STATE_ERROR);
      }

      return {
        status: 'authenticated',
        token,
        user: action.user || null,
        error: '',
      };
    }
    case 'loginFailure':
      return createAnonymousAuthState(normalizeErrorMessage(action.error));
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
    && systemKey.trim() !== ''
    && Array.isArray(user.app_access)
    && user.app_access.includes(systemKey);
};
