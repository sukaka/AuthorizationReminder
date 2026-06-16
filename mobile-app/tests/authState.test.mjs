import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authReducer,
  createInitialAuthState,
  isUserAllowedForSystem,
} from '../src/auth/authState.js';

test('initial auth state requires login', () => {
  assert.deepEqual(createInitialAuthState(), {
    status: 'checking',
    token: '',
    user: null,
    error: '',
  });
});

test('stores login success state', () => {
  const next = authReducer(createInitialAuthState(), {
    type: 'loginSuccess',
    token: 'abc',
    user: { username: 'admin', app_access: ['inventory'] },
  });

  assert.equal(next.status, 'authenticated');
  assert.equal(next.token, 'abc');
  assert.equal(next.user.username, 'admin');
});

test('login success with empty token returns anonymous state', () => {
  const next = authReducer(createInitialAuthState(), {
    type: 'loginSuccess',
    token: '   ',
    user: { username: 'admin', app_access: ['inventory'] },
  });

  assert.deepEqual(next, {
    status: 'anonymous',
    token: '',
    user: null,
    error: '登录状态无效，请重新登录',
  });
});

test('login success with missing user returns anonymous state', () => {
  const next = authReducer(createInitialAuthState(), {
    type: 'loginSuccess',
    token: 'abc',
  });

  assert.deepEqual(next, {
    status: 'anonymous',
    token: '',
    user: null,
    error: '登录状态无效，请重新登录',
  });
});

test('login success trims a valid token', () => {
  const user = { username: 'admin', app_access: ['inventory'] };
  const next = authReducer(createInitialAuthState(), {
    type: 'loginSuccess',
    token: '  abc  ',
    user,
  });

  assert.deepEqual(next, {
    status: 'authenticated',
    token: 'abc',
    user,
    error: '',
  });
});

test('checking keeps current auth details and clears errors', () => {
  const user = { username: 'admin', app_access: ['inventory'] };
  const next = authReducer(
    { status: 'anonymous', token: 'abc', user, error: 'expired' },
    { type: 'checking' }
  );

  assert.deepEqual(next, {
    status: 'checking',
    token: 'abc',
    user,
    error: '',
  });
});

test('anonymous clears auth details and errors', () => {
  const next = authReducer(
    { status: 'authenticated', token: 'abc', user: { username: 'admin' }, error: 'expired' },
    { type: 'anonymous' }
  );

  assert.deepEqual(next, {
    status: 'anonymous',
    token: '',
    user: null,
    error: '',
  });
});

test('login start keeps current auth details and clears errors', () => {
  const user = { username: 'admin', app_access: ['inventory'] };
  const next = authReducer(
    { status: 'authenticated', token: 'abc', user, error: 'expired' },
    { type: 'loginStart' }
  );

  assert.deepEqual(next, {
    status: 'authenticating',
    token: 'abc',
    user,
    error: '',
  });
});

test('login failure clears auth details and stores errors', () => {
  const state = {
    status: 'authenticating',
    token: 'abc',
    user: { username: 'admin' },
    error: '',
  };

  assert.deepEqual(authReducer(state, { type: 'loginFailure', error: 'bad credentials' }), {
    status: 'anonymous',
    token: '',
    user: null,
    error: 'bad credentials',
  });

  assert.deepEqual(authReducer(state, { type: 'loginFailure', error: new Error('network down') }), {
    status: 'anonymous',
    token: '',
    user: null,
    error: 'network down',
  });

  assert.deepEqual(authReducer(state, { type: 'loginFailure' }), {
    status: 'anonymous',
    token: '',
    user: null,
    error: '登录失败',
  });

  assert.deepEqual(authReducer(state, { type: 'loginFailure', error: '' }), {
    status: 'anonymous',
    token: '',
    user: null,
    error: '登录失败',
  });
});

test('logout clears user and token', () => {
  const next = authReducer(
    { status: 'authenticated', token: 'abc', user: { username: 'admin' }, error: '' },
    { type: 'logout' }
  );

  assert.deepEqual(next, {
    status: 'anonymous',
    token: '',
    user: null,
    error: '',
  });
});

test('system access follows app_access when present', () => {
  const user = { role: 'user', app_access: ['train-exam', 'device-flow'] };

  assert.equal(isUserAllowedForSystem(user, 'train-exam'), true);
  assert.equal(isUserAllowedForSystem(user, 'inventory'), false);
});

test('non-admin users without array app_access cannot access systems', () => {
  assert.equal(isUserAllowedForSystem({ role: 'user' }, 'inventory'), false);
  assert.equal(isUserAllowedForSystem({ role: 'user', app_access: 'inventory' }, 'inventory'), false);
});

test('blank system key denies access for non-admin users', () => {
  const user = { role: 'user', app_access: ['', '  ', 'inventory'] };

  assert.equal(isUserAllowedForSystem(user, ''), false);
  assert.equal(isUserAllowedForSystem(user, '  '), false);
});

test('admin can access all mobile systems', () => {
  assert.equal(isUserAllowedForSystem({ role: 'admin', app_access: [] }, 'inventory'), true);
});

test('admin can access mobile systems without app_access', () => {
  assert.equal(isUserAllowedForSystem({ role: 'admin' }, 'inventory'), true);
});

test('unknown action preserves state object', () => {
  const state = { status: 'anonymous', token: '', user: null, error: '' };

  assert.equal(authReducer(state, { type: 'unknown' }), state);
});

test('missing user cannot access systems', () => {
  assert.equal(isUserAllowedForSystem(null, 'inventory'), false);
});

test('admin role ignores case and surrounding spaces', () => {
  assert.equal(isUserAllowedForSystem({ role: ' Admin ', app_access: [] }, 'device-flow'), true);
});
