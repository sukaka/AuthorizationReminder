# 移动 App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 iOS/安卓内部移动 App，打开后先统一登录，再进入培训考试、库存管理、设备流转 3 个系统入口，并在 App 内访问现有网页系统。

**Architecture:** 在仓库新增 `mobile-app/` Expo 应用，业务逻辑拆成配置、认证 API、认证状态、页面组件和 WebView 会话同步 5 类。第一版用原生登录页调用现有 `auth` 服务，拿到 `juxin_auth_token` 后同步给 WebView，再打开 3 个现有系统网页。

**Tech Stack:** React Native、Expo、react-native-webview、@react-native-cookies/cookies、node:test。

---

## 文件结构

- Create: `mobile-app/package.json`，定义 Expo 应用依赖和测试脚本。
- Create: `mobile-app/app.json`，定义 Expo App 元信息。
- Create: `mobile-app/babel.config.cjs`，Expo Babel 配置。
- Create: `mobile-app/eas.json`，内部测试包构建配置。
- Create: `mobile-app/.gitignore`，忽略 Expo 和移动端构建产物。
- Create: `mobile-app/App.js`，App 根组件，串联登录、首页、WebView 页面。
- Create: `mobile-app/src/config/appConfig.js`，集中管理统一登录和 3 个系统 URL。
- Create: `mobile-app/src/auth/authApi.js`，封装统一登录、获取当前用户、退出登录 API。
- Create: `mobile-app/src/auth/authState.js`，封装认证状态 reducer 和系统权限判断。
- Create: `mobile-app/src/auth/webSession.js`，把登录 token 同步为 WebView 可用 Cookie。
- Create: `mobile-app/src/components/AppButton.js`，通用按钮。
- Create: `mobile-app/src/components/StateView.js`，加载、错误、空状态展示。
- Create: `mobile-app/src/screens/LoginScreen.js`，统一登录页。
- Create: `mobile-app/src/screens/HomeScreen.js`，3 个系统入口首页。
- Create: `mobile-app/src/screens/SystemWebViewScreen.js`，系统内嵌访问页。
- Create: `mobile-app/src/styles/theme.js`，移动端基础视觉变量。
- Create: `mobile-app/tests/appConfig.test.mjs`，配置映射测试。
- Create: `mobile-app/tests/authState.test.mjs`，认证状态和权限测试。
- Create: `mobile-app/tests/authApi.test.mjs`，认证 API 请求/错误处理测试。
- Modify: `.gitignore`，补充 `mobile-app/.expo/`、`mobile-app/dist/`、`mobile-app/android/`、`mobile-app/ios/`。
- Modify: `package.json`，补充根级移动端脚本。

## 已确认的仓库事实

- 统一登录服务：`auth`，开发端口 `5180`。
- 登录接口：`POST /api/auth/login`，请求体为 `{ username, password, captchaToken, captcha }`。
- 当前用户接口：`GET /api/auth/me`。
- 退出接口：`POST /api/auth/logout`。
- 认证 Cookie 名：`juxin_auth_token`。
- 库存管理前端开发地址：`http://localhost:18082`。
- 设备流转前端开发地址：`http://localhost:18083`。
- 培训考试前端开发地址：`http://localhost:18087`。

---

### Task 1: 移动端项目骨架和系统配置

**Files:**
- Create: `mobile-app/package.json`
- Create: `mobile-app/app.json`
- Create: `mobile-app/babel.config.cjs`
- Create: `mobile-app/eas.json`
- Create: `mobile-app/.gitignore`
- Create: `mobile-app/src/config/appConfig.js`
- Create: `mobile-app/tests/appConfig.test.mjs`
- Modify: `.gitignore`
- Modify: `package.json`

- [ ] **Step 1: 先写系统配置失败测试**

Create `mobile-app/tests/appConfig.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTH_COOKIE_NAME,
  createMobileAppConfig,
  getSystemByKey,
} from '../src/config/appConfig.js';

test('creates localhost development URLs by default', () => {
  const config = createMobileAppConfig({});

  assert.equal(config.auth.baseUrl, 'http://localhost:5180');
  assert.equal(config.auth.loginUrl, 'http://localhost:5180/api/auth/login');
  assert.equal(config.auth.meUrl, 'http://localhost:5180/api/auth/me');
  assert.equal(config.auth.logoutUrl, 'http://localhost:5180/api/auth/logout');
  assert.equal(AUTH_COOKIE_NAME, 'juxin_auth_token');
});

test('uses EXPO_PUBLIC_APP_HOST for phone-accessible development URLs', () => {
  const config = createMobileAppConfig({ EXPO_PUBLIC_APP_HOST: '192.168.1.20' });

  assert.equal(config.auth.baseUrl, 'http://192.168.1.20:5180');
  assert.deepEqual(
    config.systems.map((system) => [system.key, system.url]),
    [
      ['train-exam', 'http://192.168.1.20:18087'],
      ['inventory', 'http://192.168.1.20:18082'],
      ['device-flow', 'http://192.168.1.20:18083'],
    ]
  );
});

test('resolves systems by key', () => {
  const config = createMobileAppConfig({ EXPO_PUBLIC_APP_HOST: '10.0.0.8' });

  assert.equal(getSystemByKey(config.systems, 'inventory').name, '库存管理');
  assert.equal(getSystemByKey(config.systems, 'missing'), null);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node --test mobile-app/tests/appConfig.test.mjs
```

Expected: FAIL，提示找不到 `mobile-app/src/config/appConfig.js`。

- [ ] **Step 3: 创建 Expo 项目基础文件**

Create `mobile-app/package.json`:

```json
{
  "name": "juxin-mobile-app",
  "version": "5.72.2",
  "private": true,
  "type": "module",
  "main": "node_modules/expo/AppEntry.js",
  "scripts": {
    "start": "expo start",
    "android": "expo run:android",
    "ios": "expo run:ios",
    "test": "node --test tests/*.test.mjs",
    "build:android:preview": "eas build --platform android --profile preview",
    "build:ios:preview": "eas build --platform ios --profile preview"
  },
  "dependencies": {
    "@react-native-async-storage/async-storage": "^2.2.0",
    "@react-native-cookies/cookies": "^6.2.1",
    "expo": "^53.0.0",
    "expo-status-bar": "~2.2.3",
    "react": "19.0.0",
    "react-native": "0.79.5",
    "react-native-webview": "^13.13.5"
  },
  "devDependencies": {}
}
```

Create `mobile-app/app.json`:

```json
{
  "expo": {
    "name": "聚信移动工作台",
    "slug": "juxin-mobile-app",
    "version": "5.72.2",
    "orientation": "portrait",
    "userInterfaceStyle": "light",
    "assetBundlePatterns": ["**/*"],
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.juxin.mobile"
    },
    "android": {
      "package": "com.juxin.mobile"
    },
    "extra": {
      "appHost": ""
    }
  }
}
```

Create `mobile-app/babel.config.cjs`:

```js
module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
```

Create `mobile-app/eas.json`:

```json
{
  "cli": {
    "version": ">= 12.0.0"
  },
  "build": {
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      },
      "ios": {
        "simulator": false
      }
    },
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    }
  }
}
```

Create `mobile-app/.gitignore`:

```gitignore
.expo/
dist/
android/
ios/
*.jks
*.p8
*.p12
*.mobileprovision
```

- [ ] **Step 4: 实现系统配置**

Create `mobile-app/src/config/appConfig.js`:

```js
export const AUTH_COOKIE_NAME = 'juxin_auth_token';

const DEFAULT_PROTOCOL = 'http';
const DEFAULT_HOST = 'localhost';

const PORTS = Object.freeze({
  auth: 5180,
  trainExam: 18087,
  inventory: 18082,
  deviceFlow: 18083,
});

const normalizeProtocol = (value) => {
  const text = String(value || DEFAULT_PROTOCOL).trim().replace(/:$/, '');
  return text === 'https' ? 'https' : DEFAULT_PROTOCOL;
};

const normalizeHost = (value) => {
  const text = String(value || '').trim();
  return text || DEFAULT_HOST;
};

const buildBaseUrl = ({ protocol, host, port }) => `${protocol}://${host}:${port}`;

export const createMobileAppConfig = (env = {}) => {
  const protocol = normalizeProtocol(env.EXPO_PUBLIC_APP_PROTOCOL);
  const host = normalizeHost(env.EXPO_PUBLIC_APP_HOST || env.PUBLIC_HOST);
  const authBaseUrl = buildBaseUrl({ protocol, host, port: PORTS.auth });

  return {
    environment: env.EXPO_PUBLIC_APP_ENV || 'development',
    auth: {
      baseUrl: authBaseUrl,
      loginUrl: `${authBaseUrl}/api/auth/login`,
      meUrl: `${authBaseUrl}/api/auth/me`,
      logoutUrl: `${authBaseUrl}/api/auth/logout`,
    },
    systems: [
      {
        key: 'train-exam',
        name: '培训考试',
        description: '课程学习、考试、题库与证书',
        url: buildBaseUrl({ protocol, host, port: PORTS.trainExam }),
      },
      {
        key: 'inventory',
        name: '库存管理',
        description: '库存台账、入库出库与物流查询',
        url: buildBaseUrl({ protocol, host, port: PORTS.inventory }),
      },
      {
        key: 'device-flow',
        name: '设备流转',
        description: '设备领用、归还、维修与流转记录',
        url: buildBaseUrl({ protocol, host, port: PORTS.deviceFlow }),
      },
    ],
  };
};

export const getSystemByKey = (systems, key) => {
  const targetKey = String(key || '').trim();
  return systems.find((system) => system.key === targetKey) || null;
};
```

- [ ] **Step 5: 补充根级脚本和忽略规则**

Modify root `package.json` scripts by adding:

```json
{
  "mobile:start": "npm --prefix mobile-app run start",
  "mobile:test": "npm --prefix mobile-app test",
  "mobile:android:preview": "npm --prefix mobile-app run build:android:preview",
  "mobile:ios:preview": "npm --prefix mobile-app run build:ios:preview"
}
```

Modify root `.gitignore` by adding:

```gitignore
mobile-app/.expo/
mobile-app/dist/
mobile-app/android/
mobile-app/ios/
```

- [ ] **Step 6: 运行测试确认通过**

Run:

```bash
node --test mobile-app/tests/appConfig.test.mjs
```

Expected: PASS，3 个配置测试通过。

- [ ] **Step 7: 提交**

Run:

```bash
git add .gitignore package.json mobile-app/package.json mobile-app/app.json mobile-app/babel.config.cjs mobile-app/eas.json mobile-app/.gitignore mobile-app/src/config/appConfig.js mobile-app/tests/appConfig.test.mjs
git commit -m "feat(mobile): scaffold expo app config"
```

---

### Task 2: 认证状态和权限判断

**Files:**
- Create: `mobile-app/src/auth/authState.js`
- Create: `mobile-app/tests/authState.test.mjs`

- [ ] **Step 1: 先写认证状态失败测试**

Create `mobile-app/tests/authState.test.mjs`:

```js
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

test('admin can access all mobile systems', () => {
  assert.equal(isUserAllowedForSystem({ role: 'admin', app_access: [] }, 'inventory'), true);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node --test mobile-app/tests/authState.test.mjs
```

Expected: FAIL，提示找不到 `mobile-app/src/auth/authState.js`。

- [ ] **Step 3: 实现认证状态模块**

Create `mobile-app/src/auth/authState.js`:

```js
const ADMIN_ROLES = new Set(['admin']);

export const createInitialAuthState = () => ({
  status: 'checking',
  token: '',
  user: null,
  error: '',
});

export const authReducer = (state, action) => {
  switch (action.type) {
    case 'checking':
      return { ...state, status: 'checking', error: '' };
    case 'anonymous':
      return { status: 'anonymous', token: '', user: null, error: '' };
    case 'loginStart':
      return { ...state, status: 'authenticating', error: '' };
    case 'loginSuccess':
      return {
        status: 'authenticated',
        token: String(action.token || ''),
        user: action.user || null,
        error: '',
      };
    case 'loginFailure':
      return {
        ...state,
        status: 'anonymous',
        token: '',
        user: null,
        error: String(action.error || '登录失败'),
      };
    case 'logout':
      return { status: 'anonymous', token: '', user: null, error: '' };
    default:
      return state;
  }
};

export const isUserAllowedForSystem = (user, systemKey) => {
  if (!user) return false;
  const role = String(user.role || '').trim().toLowerCase();
  if (ADMIN_ROLES.has(role)) return true;
  const access = Array.isArray(user.app_access) ? user.app_access : [];
  return access.includes(systemKey);
};
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
node --test mobile-app/tests/authState.test.mjs
```

Expected: PASS，5 个认证状态测试通过。

- [ ] **Step 5: 提交**

Run:

```bash
git add mobile-app/src/auth/authState.js mobile-app/tests/authState.test.mjs
git commit -m "feat(mobile): add auth state model"
```

---

### Task 3: 统一登录 API 封装

**Files:**
- Create: `mobile-app/src/auth/authApi.js`
- Create: `mobile-app/tests/authApi.test.mjs`

- [ ] **Step 1: 先写认证 API 失败测试**

Create `mobile-app/tests/authApi.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchCurrentUser,
  loginWithPassword,
  logoutFromAuth,
} from '../src/auth/authApi.js';

const jsonResponse = (body, init = {}) => ({
  ok: init.ok ?? true,
  status: init.status || 200,
  async json() {
    return body;
  },
});

test('login posts username and password to auth service', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ token: 'token-1', user: { username: 'admin' } });
  };

  const result = await loginWithPassword({
    loginUrl: 'http://localhost:5180/api/auth/login',
    username: 'admin',
    password: 'secret',
    fetchImpl,
  });

  assert.equal(result.token, 'token-1');
  assert.equal(calls[0].url, 'http://localhost:5180/api/auth/login');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    username: 'admin',
    password: 'secret',
  });
});

test('login surfaces auth errors', async () => {
  await assert.rejects(
    () =>
      loginWithPassword({
        loginUrl: 'http://localhost:5180/api/auth/login',
        username: '',
        password: '',
        fetchImpl: async () => jsonResponse({ error: '请输入账号和密码' }, { ok: false, status: 400 }),
      }),
    /请输入账号和密码/
  );
});

test('login reports mfa requirement clearly', async () => {
  await assert.rejects(
    () =>
      loginWithPassword({
        loginUrl: 'http://localhost:5180/api/auth/login',
        username: 'admin',
        password: 'secret',
        fetchImpl: async () => jsonResponse({ mfaRequired: true, methods: ['sms'] }),
      }),
    /当前账号需要二次验证/
  );
});

test('fetches current user with bearer token', async () => {
  const calls = [];
  const user = await fetchCurrentUser({
    meUrl: 'http://localhost:5180/api/auth/me',
    token: 'token-1',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ username: 'admin' });
    },
  });

  assert.equal(user.username, 'admin');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer token-1');
});

test('logout posts to auth logout endpoint', async () => {
  const calls = [];
  await logoutFromAuth({
    logoutUrl: 'http://localhost:5180/api/auth/logout',
    token: 'token-1',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ ok: true });
    },
  });

  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer token-1');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node --test mobile-app/tests/authApi.test.mjs
```

Expected: FAIL，提示找不到 `mobile-app/src/auth/authApi.js`。

- [ ] **Step 3: 实现认证 API**

Create `mobile-app/src/auth/authApi.js`:

```js
const parseJson = async (response) => {
  try {
    return await response.json();
  } catch (_err) {
    return {};
  }
};

const buildAuthHeaders = (token = '') => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
};

const assertOk = async (response, fallbackMessage) => {
  const data = await parseJson(response);
  if (!response.ok) {
    throw new Error(data.error || fallbackMessage);
  }
  return data;
};

export const loginWithPassword = async ({
  loginUrl,
  username,
  password,
  captchaToken,
  captcha,
  fetchImpl = fetch,
}) => {
  const payload = {
    username: String(username || '').trim(),
    password: String(password || ''),
  };
  if (captchaToken) payload.captchaToken = captchaToken;
  if (captcha) payload.captcha = captcha;

  const response = await fetchImpl(loginUrl, {
    method: 'POST',
    headers: buildAuthHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await assertOk(response, '登录失败');
  if (data.mfaRequired || data.mfaSetupRequired) {
    throw new Error('当前账号需要二次验证，请先使用电脑端完成验证或配置后再登录移动 App');
  }
  if (!data.token) throw new Error('登录成功但未返回认证 token');
  return data;
};

export const fetchCurrentUser = async ({ meUrl, token, fetchImpl = fetch }) => {
  if (!token) return null;
  const response = await fetchImpl(meUrl, {
    method: 'GET',
    headers: buildAuthHeaders(token),
  });
  return assertOk(response, '获取登录状态失败');
};

export const logoutFromAuth = async ({ logoutUrl, token, fetchImpl = fetch }) => {
  if (!token) return { ok: true };
  const response = await fetchImpl(logoutUrl, {
    method: 'POST',
    headers: buildAuthHeaders(token),
    body: JSON.stringify({}),
  });
  return assertOk(response, '退出登录失败');
};
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
node --test mobile-app/tests/authApi.test.mjs
```

Expected: PASS，5 个认证 API 测试通过。

- [ ] **Step 5: 提交**

Run:

```bash
git add mobile-app/src/auth/authApi.js mobile-app/tests/authApi.test.mjs
git commit -m "feat(mobile): add unified auth api"
```

---

### Task 4: WebView Cookie 同步

**Files:**
- Create: `mobile-app/src/auth/webSession.js`

- [ ] **Step 1: 创建 Web 会话同步模块**

Create `mobile-app/src/auth/webSession.js`:

```js
import CookieManager from '@react-native-cookies/cookies';
import { AUTH_COOKIE_NAME } from '../config/appConfig';

export const createAuthCookie = ({ token }) => ({
  name: AUTH_COOKIE_NAME,
  value: String(token || ''),
  path: '/',
  version: '1',
  secure: false,
  httpOnly: false,
});

export const syncAuthCookieToSystems = async ({ token, urls, cookieManager = CookieManager }) => {
  if (!token) return;
  const cookie = createAuthCookie({ token });
  await Promise.all(urls.map((url) => cookieManager.set(url, cookie)));
};

export const clearWebSession = async ({ cookieManager = CookieManager } = {}) => {
  await cookieManager.clearAll();
};
```

- [ ] **Step 2: 手工检查模块边界**

Run:

```bash
sed -n '1,220p' mobile-app/src/auth/webSession.js
```

Expected: 文件只负责 Cookie 生成、同步和清理，不包含页面逻辑。

- [ ] **Step 3: 提交**

Run:

```bash
git add mobile-app/src/auth/webSession.js
git commit -m "feat(mobile): sync auth cookie for web systems"
```

---

### Task 5: 移动端 UI 和导航状态

**Files:**
- Create: `mobile-app/src/styles/theme.js`
- Create: `mobile-app/src/components/AppButton.js`
- Create: `mobile-app/src/components/StateView.js`
- Create: `mobile-app/src/screens/LoginScreen.js`
- Create: `mobile-app/src/screens/HomeScreen.js`
- Create: `mobile-app/App.js`

- [ ] **Step 1: 创建主题和基础组件**

Create `mobile-app/src/styles/theme.js`:

```js
export const theme = {
  colors: {
    background: '#f6f8fb',
    surface: '#ffffff',
    text: '#172033',
    muted: '#6b7280',
    border: '#d9e0ea',
    primary: '#1769e0',
    primaryPressed: '#0f56bd',
    danger: '#c2410c',
  },
  spacing: {
    xs: 6,
    sm: 10,
    md: 16,
    lg: 24,
    xl: 32,
  },
  radius: {
    sm: 6,
    md: 8,
  },
};
```

Create `mobile-app/src/components/AppButton.js`:

```js
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { theme } from '../styles/theme';

export const AppButton = ({ title, onPress, disabled = false, loading = false, variant = 'primary' }) => (
  <Pressable
    accessibilityRole="button"
    disabled={disabled || loading}
    onPress={onPress}
    style={({ pressed }) => [
      styles.button,
      variant === 'secondary' && styles.secondary,
      (disabled || loading) && styles.disabled,
      pressed && !disabled && !loading && styles.pressed,
    ]}
  >
    {loading ? <ActivityIndicator color="#fff" /> : <Text style={[styles.text, variant === 'secondary' && styles.secondaryText]}>{title}</Text>}
  </Pressable>
);

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.md,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
  },
  secondary: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    backgroundColor: theme.colors.primaryPressed,
  },
  text: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryText: {
    color: theme.colors.text,
  },
});
```

Create `mobile-app/src/components/StateView.js`:

```js
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { AppButton } from './AppButton';
import { theme } from '../styles/theme';

export const StateView = ({ title, message, loading = false, actionTitle, onAction }) => (
  <View style={styles.wrap}>
    {loading && <ActivityIndicator size="large" color={theme.colors.primary} />}
    <Text style={styles.title}>{title}</Text>
    {!!message && <Text style={styles.message}>{message}</Text>}
    {!!actionTitle && <AppButton title={actionTitle} onPress={onAction} />}
  </View>
);

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    flex: 1,
    gap: theme.spacing.md,
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  title: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  message: {
    color: theme.colors.muted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
});
```

- [ ] **Step 2: 创建登录页**

Create `mobile-app/src/screens/LoginScreen.js`:

```js
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { AppButton } from '../components/AppButton';
import { theme } from '../styles/theme';

export const LoginScreen = ({ error, loading, onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.wrap}>
      <View style={styles.panel}>
        <Text style={styles.title}>聚信移动工作台</Text>
        <Text style={styles.subtitle}>使用统一账号登录后访问培训考试、库存管理和设备流转。</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setUsername}
          placeholder="账号或手机号"
          style={styles.input}
          value={username}
        />
        <TextInput
          onChangeText={setPassword}
          placeholder="密码"
          secureTextEntry
          style={styles.input}
          value={password}
        />
        {!!error && <Text style={styles.error}>{error}</Text>}
        <AppButton
          disabled={!username.trim() || !password}
          loading={loading}
          onPress={() => onLogin({ username, password })}
          title="登录"
        />
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: theme.colors.background,
    flex: 1,
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  panel: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
  },
  title: {
    color: theme.colors.text,
    fontSize: 26,
    fontWeight: '900',
  },
  subtitle: {
    color: theme.colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  input: {
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: theme.spacing.md,
  },
  error: {
    color: theme.colors.danger,
    fontSize: 14,
  },
});
```

- [ ] **Step 3: 创建首页**

Create `mobile-app/src/screens/HomeScreen.js`:

```js
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppButton } from '../components/AppButton';
import { isUserAllowedForSystem } from '../auth/authState';
import { theme } from '../styles/theme';

export const HomeScreen = ({ systems, user, onOpenSystem, onLogout }) => (
  <ScrollView contentContainerStyle={styles.content} style={styles.wrap}>
    <View style={styles.header}>
      <Text style={styles.title}>移动工作台</Text>
      <Text style={styles.user}>当前用户：{user?.username || '已登录用户'}</Text>
    </View>
    <View style={styles.grid}>
      {systems.map((system) => {
        const enabled = isUserAllowedForSystem(user, system.key);
        return (
          <Pressable
            accessibilityRole="button"
            disabled={!enabled}
            key={system.key}
            onPress={() => onOpenSystem(system)}
            style={({ pressed }) => [styles.card, !enabled && styles.cardDisabled, pressed && enabled && styles.cardPressed]}
          >
            <Text style={styles.cardTitle}>{system.name}</Text>
            <Text style={styles.cardDescription}>{enabled ? system.description : '当前账号暂无该系统权限'}</Text>
          </Pressable>
        );
      })}
    </View>
    <AppButton title="退出登录" variant="secondary" onPress={onLogout} />
  </ScrollView>
);

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: theme.colors.background,
    flex: 1,
  },
  content: {
    gap: theme.spacing.lg,
    padding: theme.spacing.lg,
    paddingTop: theme.spacing.xl,
  },
  header: {
    gap: theme.spacing.xs,
  },
  title: {
    color: theme.colors.text,
    fontSize: 28,
    fontWeight: '900',
  },
  user: {
    color: theme.colors.muted,
    fontSize: 15,
  },
  grid: {
    gap: theme.spacing.md,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    minHeight: 104,
    padding: theme.spacing.lg,
  },
  cardPressed: {
    borderColor: theme.colors.primary,
  },
  cardDisabled: {
    opacity: 0.5,
  },
  cardTitle: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: '800',
  },
  cardDescription: {
    color: theme.colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: theme.spacing.sm,
  },
});
```

- [ ] **Step 4: 创建 App 根组件**

Create `mobile-app/App.js`:

```js
import React, { useEffect, useMemo, useReducer, useState } from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { createMobileAppConfig } from './src/config/appConfig';
import { authReducer, createInitialAuthState } from './src/auth/authState';
import { loginWithPassword, logoutFromAuth } from './src/auth/authApi';
import { clearWebSession, syncAuthCookieToSystems } from './src/auth/webSession';
import { HomeScreen } from './src/screens/HomeScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { StateView } from './src/components/StateView';
import { theme } from './src/styles/theme';

export default function App() {
  const config = useMemo(() => createMobileAppConfig(process.env), []);
  const [auth, dispatch] = useReducer(authReducer, undefined, createInitialAuthState);
  const [selectedSystem, setSelectedSystem] = useState(null);

  useEffect(() => {
    dispatch({ type: 'anonymous' });
  }, []);

  const handleLogin = async ({ username, password }) => {
    dispatch({ type: 'loginStart' });
    try {
      const result = await loginWithPassword({ loginUrl: config.auth.loginUrl, username, password });
      await syncAuthCookieToSystems({
        token: result.token,
        urls: [config.auth.baseUrl, ...config.systems.map((system) => system.url)],
      });
      dispatch({ type: 'loginSuccess', token: result.token, user: result.user });
    } catch (err) {
      dispatch({ type: 'loginFailure', error: err.message });
    }
  };

  const handleLogout = async () => {
    await logoutFromAuth({ logoutUrl: config.auth.logoutUrl, token: auth.token }).catch(() => null);
    await clearWebSession().catch(() => null);
    setSelectedSystem(null);
    dispatch({ type: 'logout' });
  };

  let content = null;
  if (auth.status === 'checking') {
    content = <StateView loading title="正在准备移动工作台" message="正在检查登录状态" />;
  } else if (auth.status === 'authenticated') {
    content = (
      <HomeScreen
        systems={config.systems}
        user={auth.user}
        onOpenSystem={setSelectedSystem}
        onLogout={handleLogout}
      />
    );
  } else {
    content = <LoginScreen error={auth.error} loading={auth.status === 'authenticating'} onLogin={handleLogin} />;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      {content}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: theme.colors.background,
    flex: 1,
  },
});
```

- [ ] **Step 5: 运行已有逻辑测试**

Run:

```bash
npm --prefix mobile-app test
```

Expected: PASS，配置、认证状态、认证 API 测试全部通过。

- [ ] **Step 6: 提交**

Run:

```bash
git add mobile-app/App.js mobile-app/src/styles/theme.js mobile-app/src/components/AppButton.js mobile-app/src/components/StateView.js mobile-app/src/screens/LoginScreen.js mobile-app/src/screens/HomeScreen.js
git commit -m "feat(mobile): add login and home screens"
```

---

### Task 6: 系统 WebView 页面

**Files:**
- Create: `mobile-app/src/screens/SystemWebViewScreen.js`
- Modify: `mobile-app/App.js`

- [ ] **Step 1: 创建 SystemWebViewScreen**

Create `mobile-app/src/screens/SystemWebViewScreen.js`:

```js
import React, { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { AppButton } from '../components/AppButton';
import { StateView } from '../components/StateView';
import { theme } from '../styles/theme';

export const SystemWebViewScreen = ({ system, onBackHome, onLogout }) => {
  const webViewRef = useRef(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!system) return null;

  if (failed) {
    return (
      <StateView
        title={`${system.name} 打开失败`}
        message="请检查网络或系统服务状态。"
        actionTitle="返回首页"
        onAction={onBackHome}
      />
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.toolbar}>
        <AppButton title="首页" variant="secondary" onPress={onBackHome} />
        <Text numberOfLines={1} style={styles.title}>{system.name}</Text>
        <AppButton
          title={canGoBack ? '后退' : '刷新'}
          variant="secondary"
          onPress={() => {
            if (canGoBack) webViewRef.current?.goBack();
            else webViewRef.current?.reload();
          }}
        />
        <AppButton title="退出" variant="secondary" onPress={onLogout} />
      </View>
      <WebView
        ref={webViewRef}
        source={{ uri: system.url }}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        startInLoadingState
        onNavigationStateChange={(event) => setCanGoBack(event.canGoBack)}
        onError={() => setFailed(true)}
        onHttpError={(event) => {
          if (event.nativeEvent.statusCode === 401 || event.nativeEvent.statusCode === 403) onLogout();
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: theme.colors.background,
    flex: 1,
  },
  toolbar: {
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderBottomColor: theme.colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: theme.spacing.sm,
    padding: theme.spacing.sm,
  },
  title: {
    color: theme.colors.text,
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
});
```

- [ ] **Step 2: 接入 App 根组件**

Modify `mobile-app/App.js`:

```js
import { SystemWebViewScreen } from './src/screens/SystemWebViewScreen';
```

Replace the authenticated content branch with:

```js
  } else if (auth.status === 'authenticated') {
    content = selectedSystem ? (
      <SystemWebViewScreen
        system={selectedSystem}
        onBackHome={() => setSelectedSystem(null)}
        onLogout={handleLogout}
      />
    ) : (
      <HomeScreen
        systems={config.systems}
        user={auth.user}
        onOpenSystem={setSelectedSystem}
        onLogout={handleLogout}
      />
    );
```

- [ ] **Step 3: 运行逻辑测试**

Run:

```bash
npm --prefix mobile-app test
```

Expected: PASS。

- [ ] **Step 4: 提交**

Run:

```bash
git add mobile-app/App.js mobile-app/src/screens/SystemWebViewScreen.js
git commit -m "feat(mobile): open systems in webview"
```

---

### Task 7: 依赖安装和本地启动验证

**Files:**
- Modify: `mobile-app/package-lock.json`

- [ ] **Step 1: 安装移动端依赖**

Run:

```bash
npm --prefix mobile-app install
```

Expected: 生成 `mobile-app/package-lock.json`，依赖安装成功。

- [ ] **Step 2: 运行移动端逻辑测试**

Run:

```bash
npm --prefix mobile-app test
```

Expected: PASS。

- [ ] **Step 3: 启动 Expo 开发服务**

Run:

```bash
EXPO_PUBLIC_APP_HOST=<你的电脑局域网 IP> npm --prefix mobile-app run start
```

Expected: Expo 输出二维码和 Metro 服务地址。用真机 Expo Go 或模拟器打开后，可以看到统一登录页。

- [ ] **Step 4: 提交锁文件**

Run:

```bash
git add mobile-app/package-lock.json
git commit -m "build(mobile): install expo dependencies"
```

---

### Task 8: 手工真机验证和交付说明

**Files:**
- Create: `mobile-app/README.md`

- [ ] **Step 1: 写移动端说明文档**

Create `mobile-app/README.md`:

```markdown
# 聚信移动工作台

内部 iOS/安卓 App，用于统一登录后访问：

- 培训考试
- 库存管理
- 设备流转

## 本地启动

先启动后端和目标系统：

```bash
docker compose up --build auth web-inventory web-device-flow web-train-exam
```

再启动移动端：

```bash
EXPO_PUBLIC_APP_HOST=<你的电脑局域网 IP> npm run start
```

手机必须和开发电脑在同一网络内。不要使用 `localhost` 作为真机访问地址，因为手机上的 `localhost` 指向手机本机。

## 测试

```bash
npm test
```

## 内部构建

安卓预览包：

```bash
npm run build:android:preview
```

iOS 预览包：

```bash
npm run build:ios:preview
```

iOS 构建需要 Apple 开发者账号和对应签名能力。
```

- [ ] **Step 2: 执行最终检查**

Run:

```bash
npm --prefix mobile-app test
```

Expected: PASS。

Run:

```bash
git status --short
```

Expected: 只显示本次 README 或移动端相关文件变更；不要包含已有 big-screen 未提交改动。

- [ ] **Step 3: 提交说明文档**

Run:

```bash
git add mobile-app/README.md
git commit -m "docs(mobile): add app setup guide"
```

---

## 验收清单

- [ ] `npm --prefix mobile-app test` 通过。
- [ ] `EXPO_PUBLIC_APP_HOST=<局域网 IP> npm --prefix mobile-app run start` 能启动 Expo。
- [ ] App 首屏显示统一登录页。
- [ ] 输入统一账号后能进入移动工作台首页。
- [ ] 首页显示培训考试、库存管理、设备流转。
- [ ] 点击有权限的系统后在 App 内打开对应网页。
- [ ] WebView 页面支持返回首页、后退/刷新、退出登录。
- [ ] 退出登录会清理 App 状态并回到登录页。
- [ ] 未提交的非移动端历史改动保持不变。

## 自检结果

- 设计文档中的统一登录、3 个系统入口、WebView 内嵌访问、错误重试、内部分发配置都已映射到任务。
- 第一版不重做 3 个系统原生业务页面，范围保持在 App 壳、登录、入口、WebView 和构建配置。
- 计划中每个任务都包含具体文件、代码片段、命令和预期结果。
- 需要联网安装 npm 依赖和后续 EAS 构建时，应按当前环境权限规则请求批准。
