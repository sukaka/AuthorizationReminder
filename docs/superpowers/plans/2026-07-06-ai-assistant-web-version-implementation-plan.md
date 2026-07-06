# AI Assistant Web Version Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser-accessible 聚信 AI 助手 Web version that reuses the existing React/FastAPI system, supports public-network access through unified login, and preserves the current Tauri desktop client.

**Architecture:** Keep one React codebase with two runtime modes: `desktop` and `web`. Tauri-only behavior is moved behind runtime capability and bridge modules; Web-only behavior uses HTTP APIs, server-side session cookies, and controlled downloads. FastAPI remains the shared backend, with production SPA serving, strict auth/session behavior, and file/download safeguards for public access.

**Tech Stack:** React 19, Vite 8, TypeScript 6, Tauri 2, FastAPI, SQLAlchemy, Pytest, Vitest, Playwright, existing auth service, existing export/knowledge/chat APIs.

## Global Constraints

- Web 版第一阶段只开放聚信内部员工和管理员。
- 架构预留未来客户账号、客户项目空间和资料权限隔离，但一期不开放客户访问。
- 不重写一套 Web，不复制桌面端页面。
- 不破坏现有 Tauri 桌面端打包和使用路径。
- Web 端不保存个人模型 API Key。
- Web 端不显示钥匙串、本地模型、本地草稿、桌面自动更新、本地打开文件等桌面能力。
- 公网访问必须统一登录；未登录不能访问核心功能。
- 前端不把访问令牌写入 `localStorage`。
- 文件上传限制类型和大小。
- 文件下载和 Word 导出必须鉴权，不暴露服务器真实路径。
- 日志不输出完整 API Key、完整 prompt、私有资料正文。
- 本轮只做员工 Web 最小闭环，不做客户入口、不做完整多租户后台、不重写 UI。

---

## Source Spec

This plan implements `/Users/zhanglei/.codex/worktrees/29dc/codex-new/docs/superpowers/specs/2026-07-06-ai-assistant-web-version-design.md`.

## File Structure

### Frontend runtime boundary

- Create: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/src/runtime/platform.ts`
- Create: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/src/runtime/capabilities.ts`
- Create: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/src/runtime/downloads.ts`
- Modify: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/src/api/client.ts`
- Modify: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/src/api/chat.ts`
- Modify: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/src/App.tsx`
- Modify: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/src/pages/ChatPage.tsx`
- Modify: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/src/pages/TaskRunPage.tsx`
- Modify: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/src/launcher/WorkspaceUpdateControl.tsx`
- Modify: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/src/launcher/LauncherPage.tsx`

### Frontend tests

- Create: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/tests/runtime-platform.test.ts`
- Create: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/tests/web-mode.test.tsx`
- Create: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/tests/web-downloads.test.ts`
- Modify: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/tests/session.test.tsx`
- Modify: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/tests/setup.ts`

### Build and deployment

- Modify: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/package.json`
- Modify: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/vite.config.ts`
- Modify: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/app/config.py`
- Modify: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/app/main.py`
- Create: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/app/static_web.py`
- Create: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/tests/test_static_web.py`
- Create: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/tests/test_web_public_security.py`

### Documentation

- Create: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/docs/web-deployment.md`

---

## Task 1: Runtime Platform And Capability Boundary

**Files:**

- Create: `apps/desktop/src/runtime/platform.ts`
- Create: `apps/desktop/src/runtime/capabilities.ts`
- Create: `apps/desktop/tests/runtime-platform.test.ts`
- Test: `apps/desktop/tests/runtime-platform.test.ts`

**Interfaces:**

- Produces: `RuntimePlatform`, `detectRuntimePlatform`, `isDesktopRuntime`, `isWebRuntime`.
- Produces: `RuntimeCapabilities`, `getRuntimeCapabilities`.
- Consumed by: `App.tsx`, `ChatPage.tsx`, `TaskRunPage.tsx`, `WorkspaceUpdateControl.tsx`, `api/client.ts`, `api/chat.ts`.

- [ ] **Step 1: Write the failing runtime platform test**

Create `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/tests/runtime-platform.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  detectRuntimePlatform,
  getRuntimeCapabilities,
  isDesktopRuntime,
  isWebRuntime,
} from '../src/runtime/capabilities';

describe('runtime platform detection', () => {
  it('detects web when Tauri internals are absent', () => {
    expect(detectRuntimePlatform({})).toBe('web');
    expect(isWebRuntime({})).toBe(true);
    expect(isDesktopRuntime({})).toBe(false);
  });

  it('detects desktop when Tauri internals exist', () => {
    const runtime = { __TAURI_INTERNALS__: { metadata: { currentWebview: { label: 'workspace' } } } };

    expect(detectRuntimePlatform(runtime)).toBe('desktop');
    expect(isDesktopRuntime(runtime)).toBe(true);
    expect(isWebRuntime(runtime)).toBe(false);
  });

  it('disables desktop-only capabilities in web mode', () => {
    expect(getRuntimeCapabilities('web')).toEqual({
      platform: 'web',
      canUseLocalKeychain: false,
      canUseLocalDrafts: false,
      canOpenLocalFile: false,
      canUseAutoUpdater: false,
      canUseServerWordExport: true,
      canUseUnifiedLogin: true,
    });
  });

  it('keeps desktop capabilities in desktop mode', () => {
    expect(getRuntimeCapabilities('desktop')).toEqual({
      platform: 'desktop',
      canUseLocalKeychain: true,
      canUseLocalDrafts: true,
      canOpenLocalFile: true,
      canUseAutoUpdater: true,
      canUseServerWordExport: true,
      canUseUnifiedLogin: true,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm test -- runtime-platform.test.ts
```

Expected: FAIL because `../src/runtime/capabilities` does not exist.

- [ ] **Step 3: Add minimal runtime implementation**

Create `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/src/runtime/platform.ts`:

```ts
export type RuntimePlatform = 'desktop' | 'web';

type RuntimeLike = {
  __TAURI_INTERNALS__?: unknown;
};

export function detectRuntimePlatform(runtime: RuntimeLike = window): RuntimePlatform {
  return runtime.__TAURI_INTERNALS__ ? 'desktop' : 'web';
}

export function isDesktopRuntime(runtime: RuntimeLike = window): boolean {
  return detectRuntimePlatform(runtime) === 'desktop';
}

export function isWebRuntime(runtime: RuntimeLike = window): boolean {
  return detectRuntimePlatform(runtime) === 'web';
}
```

Create `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/src/runtime/capabilities.ts`:

```ts
import {
  detectRuntimePlatform,
  isDesktopRuntime,
  isWebRuntime,
  type RuntimePlatform,
} from './platform';

export type RuntimeCapabilities = {
  platform: RuntimePlatform;
  canUseLocalKeychain: boolean;
  canUseLocalDrafts: boolean;
  canOpenLocalFile: boolean;
  canUseAutoUpdater: boolean;
  canUseServerWordExport: boolean;
  canUseUnifiedLogin: boolean;
};

export { detectRuntimePlatform, isDesktopRuntime, isWebRuntime };

export function getRuntimeCapabilities(platform = detectRuntimePlatform()): RuntimeCapabilities {
  if (platform === 'desktop') {
    return {
      platform,
      canUseLocalKeychain: true,
      canUseLocalDrafts: true,
      canOpenLocalFile: true,
      canUseAutoUpdater: true,
      canUseServerWordExport: true,
      canUseUnifiedLogin: true,
    };
  }

  return {
    platform,
    canUseLocalKeychain: false,
    canUseLocalDrafts: false,
    canOpenLocalFile: false,
    canUseAutoUpdater: false,
    canUseServerWordExport: true,
    canUseUnifiedLogin: true,
  };
}
```

- [ ] **Step 4: Run runtime tests**

Run:

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm test -- runtime-platform.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new
 git add juxin-ai-assistant/apps/desktop/src/runtime/platform.ts \
  juxin-ai-assistant/apps/desktop/src/runtime/capabilities.ts \
  juxin-ai-assistant/apps/desktop/tests/runtime-platform.test.ts
 git commit -m "feat(ai-assistant): add web runtime capability boundary"
```

---

## Task 2: Web-Safe API Session And SSO Token Handling

**Files:**

- Modify: `apps/desktop/src/api/client.ts`
- Modify: `apps/desktop/tests/session.test.tsx`
- Test: `apps/desktop/tests/session.test.tsx`

**Interfaces:**

- Consumes: `isDesktopRuntime()` from `src/runtime/capabilities.ts`.
- Produces: Web mode `apiFetch()` that uses cookies only and never reads desktop SSO handoff token.
- Produces: Desktop mode `apiFetch()` that keeps current bearer-token handoff behavior.

- [ ] **Step 1: Add failing session tests**

Append to `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/tests/session.test.tsx`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '../src/api/client';

describe('apiFetch runtime token behavior', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
    // @ts-expect-error test cleanup
    delete window.__TAURI_INTERNALS__;
  });

  it('does not attach desktop bearer token in web mode', async () => {
    sessionStorage.setItem('juxin_ai_assistant_sso_token', 'desktop-token');
    const fetchMock = vi.spyOn(window, 'fetch').mockResolvedValue(new Response('{}'));

    await apiFetch('/api/ai/session');

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBeNull();
    expect(init?.credentials).toBe('include');
  });

  it('attaches desktop bearer token only in desktop mode', async () => {
    window.__TAURI_INTERNALS__ = { metadata: { currentWebview: { label: 'workspace' } } };
    sessionStorage.setItem('juxin_ai_assistant_sso_token', 'desktop-token');
    const fetchMock = vi.spyOn(window, 'fetch').mockResolvedValue(new Response('{}'));

    await apiFetch('/api/ai/session');

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer desktop-token');
    expect(init?.credentials).toBe('include');
  });
});
```

If the file already imports the same Vitest helpers, merge the imports instead of duplicating them.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm test -- session.test.tsx
```

Expected: FAIL because `apiFetch()` still reads the desktop token based on `window.__TAURI_INTERNALS__` directly and `client.ts` imports Tauri unnecessarily.

- [ ] **Step 3: Update `client.ts` to use runtime detection and remove unused Tauri import**

Modify `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/src/api/client.ts`:

```ts
import { isDesktopRuntime } from '../runtime/capabilities';
```

Remove this import:

```ts
import { invoke } from '@tauri-apps/api/core';
```

Change `readDesktopSsoToken()` to:

```ts
function readDesktopSsoToken(): string {
  if (!isDesktopRuntime()) return '';
  try {
    const url = new URL(window.location.href);
    const handoffToken = String(url.searchParams.get('sso_token') || '').trim();
    if (handoffToken) {
      sessionStorage.setItem(DESKTOP_SSO_TOKEN_KEY, handoffToken);
      clearSsoCallbackParams();
      return handoffToken;
    }
    return String(sessionStorage.getItem(DESKTOP_SSO_TOKEN_KEY) || '').trim();
  } catch {
    return '';
  }
}
```

Change `getAuthPortalUrl()` desktop branch from `window.__TAURI_INTERNALS__ && ...` to `isDesktopRuntime() && ...`.

- [ ] **Step 4: Run session tests**

Run:

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm test -- session.test.tsx runtime-platform.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new
 git add juxin-ai-assistant/apps/desktop/src/api/client.ts \
  juxin-ai-assistant/apps/desktop/tests/session.test.tsx
 git commit -m "feat(ai-assistant): make api session handling web safe"
```

---

## Task 3: Web Mode UI Capability Gating

**Files:**

- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/launcher/WorkspaceUpdateControl.tsx`
- Create: `apps/desktop/tests/web-mode.test.tsx`
- Test: `apps/desktop/tests/web-mode.test.tsx`

**Interfaces:**

- Consumes: `getRuntimeCapabilities()` from `src/runtime/capabilities.ts`.
- Produces: Web UI that hides desktop-only navigation and update controls.
- Produces: Desktop UI that keeps the existing model settings and updater controls.

- [ ] **Step 1: Write failing Web mode UI tests**

Create `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/tests/web-mode.test.tsx`:

```tsx
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import App from '../src/App';

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client');
  return {
    ...actual,
    getSession: vi.fn().mockResolvedValue({
      user: { id: 'u1', username: 'admin', role: 'admin' },
      scope: { department: '通用', managedDepartments: ['通用'] },
      apps: ['ai-assistant'],
      local_binding_token: 'local-binding-token',
    }),
    clearSsoCallbackParams: vi.fn(),
    getAuthPortalUrl: vi.fn(() => 'http://localhost:5180/portal?system=ai-assistant'),
  };
});

vi.mock('../src/api/chat', () => ({
  listChatSessions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
}));

describe('web mode app shell', () => {
  it('hides desktop-only model settings and updater in web mode', async () => {
    // @ts-expect-error test runtime
    delete window.__TAURI_INTERNALS__;

    render(<App />);

    expect(await screen.findByText('工作台')).toBeInTheDocument();
    expect(screen.queryByText('应用更新未启用')).not.toBeInTheDocument();
    expect(screen.queryByText('个人模型')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm test -- web-mode.test.tsx
```

Expected: FAIL because `App.tsx` still imports and renders desktop-only controls unconditionally.

- [ ] **Step 3: Gate desktop-only UI in `App.tsx`**

Modify `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/src/App.tsx`:

```ts
import { getRuntimeCapabilities } from './runtime/capabilities';
```

Inside `Workspace()` add:

```ts
const capabilities = getRuntimeCapabilities();
```

Remove the unused direct Tauri import if present:

```ts
import { invoke } from '@tauri-apps/api/core';
```

Change model/settings navigation so Web mode shows only ordinary settings and not local model keychain configuration:

```tsx
{capabilities.canUseLocalKeychain ? (
  <button aria-current={page === 'models' ? 'page' : undefined} className={page === 'models' ? 'is-current' : ''} onClick={() => setPage('models')} type="button"><span className="nav-icon" aria-hidden="true">◇</span><span className="nav-label">设置</span></button>
) : null}
```

Change sidebar footer updater rendering:

```tsx
{capabilities.canUseAutoUpdater ? <WorkspaceUpdateControl /> : null}
```

Change the page guard:

```ts
useEffect(() => {
  if (!capabilities.canUseLocalKeychain && page === 'models') {
    setPage('home');
  }
}, [capabilities.canUseLocalKeychain, page]);
```

Change the page render branch:

```tsx
{page === 'models' && capabilities.canUseLocalKeychain ? (
  <ModelProfilesPage />
) : page === 'governance' && isAdmin ? (
  <GovernanceCenter session={session} />
) : /* keep existing branches */ null}
```

- [ ] **Step 4: Keep WorkspaceUpdateControl desktop-only**

Modify `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/src/launcher/WorkspaceUpdateControl.tsx`:

```ts
import { getRuntimeCapabilities } from '../runtime/capabilities';
```

At the top of the component body:

```ts
if (!getRuntimeCapabilities().canUseAutoUpdater) return null;
```

- [ ] **Step 5: Run Web mode and existing navigation tests**

Run:

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm test -- web-mode.test.tsx admin-navigation.test.tsx employee-flow.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new
 git add juxin-ai-assistant/apps/desktop/src/App.tsx \
  juxin-ai-assistant/apps/desktop/src/launcher/WorkspaceUpdateControl.tsx \
  juxin-ai-assistant/apps/desktop/tests/web-mode.test.tsx
 git commit -m "feat(ai-assistant): hide desktop-only controls in web mode"
```

---

## Task 4: Web-Safe Word Download And Local File Opening

**Files:**

- Create: `apps/desktop/src/runtime/downloads.ts`
- Modify: `apps/desktop/src/api/chat.ts`
- Modify: `apps/desktop/src/api/client.ts`
- Modify: `apps/desktop/src/pages/ChatPage.tsx`
- Modify: `apps/desktop/src/pages/TaskRunPage.tsx`
- Create: `apps/desktop/tests/web-downloads.test.ts`
- Test: `apps/desktop/tests/web-downloads.test.ts`

**Interfaces:**

- Produces: `downloadBlobFromResponse(response: Response, fallbackFileName: string): Promise<string>`.
- Produces: `openLocalWordFile(path: string): Promise<'opened' | 'unsupported'>`.
- Consumed by: chat export and generation export flows.

- [ ] **Step 1: Write failing download tests**

Create `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/tests/web-downloads.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadBlobFromResponse, openLocalWordFile } from '../src/runtime/downloads';

describe('web downloads', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // @ts-expect-error test cleanup
    delete window.__TAURI_INTERNALS__;
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:download-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  it('downloads response blob through a browser anchor', async () => {
    const click = vi.fn();
    const appendChild = vi.spyOn(document.body, 'appendChild');
    const removeChild = vi.spyOn(document.body, 'removeChild');
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const element = document.createElementNS('http://www.w3.org/1999/xhtml', tagName) as HTMLAnchorElement;
      if (tagName === 'a') element.click = click;
      return element as HTMLElement;
    });
    const response = new Response(new Blob(['docx']), {
      headers: {
        'Content-Disposition': "attachment; filename*=UTF-8''%E6%B5%8B%E8%AF%95.docx",
      },
    });

    const fileName = await downloadBlobFromResponse(response, 'fallback.docx');

    expect(fileName).toBe('测试.docx');
    expect(click).toHaveBeenCalledTimes(1);
    expect(appendChild).toHaveBeenCalledTimes(1);
    expect(removeChild).toHaveBeenCalledTimes(1);
  });

  it('does not try to open local files in web mode', async () => {
    await expect(openLocalWordFile('/Users/example/result.docx')).resolves.toBe('unsupported');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm test -- web-downloads.test.ts
```

Expected: FAIL because `src/runtime/downloads.ts` does not exist.

- [ ] **Step 3: Implement Web-safe download helper**

Create `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/src/runtime/downloads.ts`:

```ts
import { invoke } from '@tauri-apps/api/core';

import { isDesktopRuntime } from './capabilities';

function fileNameFromDisposition(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback;
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1].replace(/"/g, ''));
  const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
  if (plainMatch?.[1]) return plainMatch[1];
  return fallback;
}

export async function downloadBlobFromResponse(
  response: Response,
  fallbackFileName: string,
): Promise<string> {
  const blob = await response.blob();
  const fileName = fileNameFromDisposition(
    response.headers.get('Content-Disposition'),
    fallbackFileName,
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
  return fileName;
}

export async function openLocalWordFile(path: string): Promise<'opened' | 'unsupported'> {
  if (!isDesktopRuntime()) return 'unsupported';
  await invoke('generation_word_open', { path });
  return 'opened';
}
```

- [ ] **Step 4: Replace ad-hoc browser download logic**

Modify `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/src/api/chat.ts` and `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/src/api/client.ts` so existing Word export response download code calls:

```ts
import { downloadBlobFromResponse } from '../runtime/downloads';
```

Use this pattern:

```ts
const response = await apiFetch(meta.download_url);
if (!response.ok) throw new Error('WORD_EXPORT_DOWNLOAD_FAILED');
const fileName = await downloadBlobFromResponse(response, meta.file_name || '聚信AI助手导出.docx');
return { fileName, path: '', downloadUrl: meta.download_url };
```

For desktop-specific paths that already return a local `path`, keep the existing path return and use `downloadBlobFromResponse` only when the response is a browser download.

- [ ] **Step 5: Replace direct Tauri file opening in ChatPage**

Modify `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/src/pages/ChatPage.tsx`:

Remove:

```ts
import { invoke } from '@tauri-apps/api/core';
```

Add:

```ts
import { openLocalWordFile } from '../runtime/downloads';
```

Change `openExportedWord` or equivalent handler to:

```ts
const result = await openLocalWordFile(exportNotice.path);
setExportNotice({
  ...exportNotice,
  openStatus: result === 'opened' ? '正在打开文件…' : '当前环境不支持直接打开文件',
  copyStatus: '',
});
```

- [ ] **Step 6: Run download and chat tests**

Run:

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm test -- web-downloads.test.ts chat-page.test.tsx task-run.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new
 git add juxin-ai-assistant/apps/desktop/src/runtime/downloads.ts \
  juxin-ai-assistant/apps/desktop/src/api/chat.ts \
  juxin-ai-assistant/apps/desktop/src/api/client.ts \
  juxin-ai-assistant/apps/desktop/src/pages/ChatPage.tsx \
  juxin-ai-assistant/apps/desktop/src/pages/TaskRunPage.tsx \
  juxin-ai-assistant/apps/desktop/tests/web-downloads.test.ts
 git commit -m "feat(ai-assistant): support browser word downloads"
```

---

## Task 5: Production SPA Static Serving

**Files:**

- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/vite.config.ts`
- Modify: `server/app/config.py`
- Create: `server/app/static_web.py`
- Modify: `server/app/main.py`
- Create: `server/tests/test_static_web.py`
- Test: `server/tests/test_static_web.py`

**Interfaces:**

- Produces: `Settings.web_static_dir: str`.
- Produces: `Settings.web_spa_enabled: bool`.
- Produces: `create_static_web_handler(settings: Settings)` for serving built Web assets.
- Consumes: existing FastAPI app and dev proxy fallback.

- [ ] **Step 1: Write failing static Web tests**

Create `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/tests/test_static_web.py`:

```python
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.static_web import mount_static_web


def test_static_web_serves_index_for_spa_route(tmp_path: Path):
    dist = tmp_path / "dist"
    assets = dist / "assets"
    assets.mkdir(parents=True)
    (dist / "index.html").write_text("<div id='root'></div>", encoding="utf-8")
    (assets / "app.js").write_text("console.log('ok')", encoding="utf-8")

    app = FastAPI()
    mount_static_web(app, static_dir=str(dist), enabled=True)
    client = TestClient(app)

    response = client.get("/history")

    assert response.status_code == 200
    assert "<div id='root'></div>" in response.text


def test_static_web_does_not_capture_api_routes(tmp_path: Path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("index", encoding="utf-8")

    app = FastAPI()
    mount_static_web(app, static_dir=str(dist), enabled=True)
    client = TestClient(app)

    response = client.get("/api/ai/session")

    assert response.status_code == 404


def test_static_web_disabled_returns_404(tmp_path: Path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("index", encoding="utf-8")

    app = FastAPI()
    mount_static_web(app, static_dir=str(dist), enabled=False)
    client = TestClient(app)

    response = client.get("/")

    assert response.status_code == 404
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
pytest tests/test_static_web.py -q
```

Expected: FAIL because `app.static_web` does not exist.

- [ ] **Step 3: Implement static Web helper**

Create `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/app/static_web.py`:

```python
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


def mount_static_web(app: FastAPI, *, static_dir: str, enabled: bool) -> None:
    root = Path(static_dir).resolve()
    assets = root / "assets"
    index = root / "index.html"

    if enabled and assets.exists():
        app.mount("/assets", StaticFiles(directory=str(assets)), name="web-assets")

    @app.get("/{full_path:path}")
    async def serve_web_spa(full_path: str, request: Request):
        if request.url.path.startswith("/api/"):
            raise HTTPException(status_code=404)
        if not enabled or not index.exists():
            raise HTTPException(status_code=404)
        return FileResponse(index)
```

- [ ] **Step 4: Add settings**

Modify `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/app/config.py`:

```python
web_spa_enabled: bool = False
web_static_dir: str = "../apps/desktop/dist"
```

- [ ] **Step 5: Replace dev-only catch-all in `main.py`**

Modify `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/app/main.py`:

Import:

```python
from .static_web import mount_static_web
```

Keep the existing dev proxy behavior only when `auth_dev_bypass` is true and `web_spa_enabled` is false. Replace the current catch-all route with this branching rule:

```python
if settings.web_spa_enabled:
    mount_static_web(app, static_dir=settings.web_static_dir, enabled=True)
else:
    @app.get("/{full_path:path}")
    async def proxy_spa(
        full_path: str,
        request: Request,
        current_settings: Annotated[Settings, Depends(get_settings)],
    ):
        """Dev mode: proxy SPA requests to Vite dev server."""
        if not current_settings.auth_dev_bypass:
            raise HTTPException(404)

        vite_url = f"http://localhost:18093/{full_path}"
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                upstream = await client.get(
                    vite_url,
                    headers={k: v for k, v in request.headers.items() if k.lower() not in ("host",)},
                )
            return Response(
                content=upstream.content,
                status_code=upstream.status_code,
                headers=dict(upstream.headers),
            )
        except httpx.HTTPError:
            return Response(content="Dev proxy unavailable", status_code=502)
```

- [ ] **Step 6: Add Web build script**

Modify `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/package.json` scripts:

```json
{
  "build:web": "tsc --noEmit && vite build --mode web"
}
```

Do not remove existing `build` or `tauri:*` scripts.

- [ ] **Step 7: Run static Web tests and frontend build**

Run:

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
pytest tests/test_static_web.py -q
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm run build:web
```

Expected: both PASS.

- [ ] **Step 8: Commit**

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new
 git add juxin-ai-assistant/apps/desktop/package.json \
  juxin-ai-assistant/apps/desktop/vite.config.ts \
  juxin-ai-assistant/server/app/config.py \
  juxin-ai-assistant/server/app/main.py \
  juxin-ai-assistant/server/app/static_web.py \
  juxin-ai-assistant/server/tests/test_static_web.py
 git commit -m "feat(ai-assistant): serve web spa in production"
```

---

## Task 6: Public Web Security Regression Tests

**Files:**

- Create: `server/tests/test_web_public_security.py`
- Modify: `server/app/config.py`
- Modify: `server/app/main.py`
- Test: `server/tests/test_web_public_security.py`

**Interfaces:**

- Consumes: existing `get_session()` and `require_action()` behavior.
- Produces: tests proving unauthenticated Web requests are rejected and untrusted write origins are blocked.

- [ ] **Step 1: Write failing public security tests**

Create `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/tests/test_web_public_security.py`:

```python
from fastapi.testclient import TestClient

from app.main import app


def test_public_web_requires_auth_for_session(monkeypatch):
    monkeypatch.setenv("AUTH_DEV_BYPASS", "false")
    client = TestClient(app)

    response = client.get("/api/ai/session")

    assert response.status_code == 401


def test_public_web_blocks_untrusted_write_origin(monkeypatch):
    monkeypatch.setenv("AUTH_DEV_BYPASS", "false")
    monkeypatch.setenv("CORS_ORIGINS", "https://ai.example.com")
    client = TestClient(app)

    response = client.post(
        "/api/ai/logout",
        headers={"Origin": "https://evil.example.com"},
    )

    assert response.status_code == 403
    assert response.json()["code"] == "ORIGIN_FORBIDDEN"


def test_public_web_allows_trusted_write_origin(monkeypatch):
    monkeypatch.setenv("AUTH_DEV_BYPASS", "false")
    monkeypatch.setenv("CORS_ORIGINS", "https://ai.example.com")
    client = TestClient(app)

    response = client.post(
        "/api/ai/logout",
        headers={"Origin": "https://ai.example.com"},
    )

    assert response.status_code in {204, 503}
```

If existing test fixtures instantiate settings before monkeypatching, use the project’s existing settings reset fixture from `server/tests/conftest.py` instead of importing `app` globally.

- [ ] **Step 2: Run test and observe current behavior**

Run:

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
pytest tests/test_web_public_security.py -q
```

Expected: The untrusted origin test should pass with current middleware; the trusted origin or auth test may need settings-cache reset wiring.

- [ ] **Step 3: Add explicit production guidance settings if needed**

If the tests show settings are cached too early, modify `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/tests/test_web_public_security.py` to use the existing project pattern for clearing `get_settings()` cache:

```python
from app.config import get_settings


def setup_function():
    get_settings.cache_clear()


def teardown_function():
    get_settings.cache_clear()
```

- [ ] **Step 4: Ensure CORS and write-origin rules stay strict**

Do not loosen this existing middleware in `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/app/main.py`:

```python
@app.middleware("http")
async def enforce_write_origin(...):
    ...
```

Only change it if tests prove it incorrectly blocks same-origin Web requests. The allowed same-origin condition must remain based on `settings.allowed_origins`.

- [ ] **Step 5: Run security tests**

Run:

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
pytest tests/test_web_public_security.py tests/test_auth.py tests/test_secret_boundary.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new
 git add juxin-ai-assistant/server/tests/test_web_public_security.py \
  juxin-ai-assistant/server/app/config.py \
  juxin-ai-assistant/server/app/main.py
 git commit -m "test(ai-assistant): cover public web security boundaries"
```

---

## Task 7: Web Mode Build Guard Against Tauri-Only Imports

**Files:**

- Modify: `apps/desktop/vite.config.ts`
- Create: `apps/desktop/tests/web-build-boundary.test.ts`
- Test: `apps/desktop/tests/web-build-boundary.test.ts`

**Interfaces:**

- Produces: a regression test that fails if Web runtime files import `@tauri-apps/api` outside allowed desktop-only modules.
- Allowed desktop-only modules: `src/remote/desktopBridge.ts`, `src/local/*.ts`, `src/runtime/downloads.ts`, `src/pages/ModelProfilesPage.tsx`, `src/launcher/*`.

- [ ] **Step 1: Write failing import boundary test**

Create `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/tests/web-build-boundary.test.ts`:

```ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', 'src');
const allowed = [
  'remote/desktopBridge.ts',
  'local/drafts.ts',
  'local/modelStream.ts',
  'local/syncQueue.ts',
  'runtime/downloads.ts',
  'pages/ModelProfilesPage.tsx',
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (/\.(ts|tsx)$/.test(path)) return [path];
    return [];
  });
}

describe('web build tauri boundary', () => {
  it('keeps direct Tauri imports inside approved desktop-only modules', () => {
    const offenders = sourceFiles(root)
      .map((file) => relative(root, file))
      .filter((file) => !allowed.includes(file))
      .filter((file) => readFileSync(join(root, file), 'utf8').includes('@tauri-apps/api'));

    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails before cleanup**

Run:

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm test -- web-build-boundary.test.ts
```

Expected: FAIL if `App.tsx`, `ChatPage.tsx`, `TaskRunPage.tsx`, or `api/client.ts` still import `@tauri-apps/api`.

- [ ] **Step 3: Move remaining direct Tauri imports behind helpers**

For each offender reported by the test:

1. If it opens a local file, call `openLocalWordFile()` from `runtime/downloads.ts`.
2. If it saves model profiles, keep the import inside `pages/ModelProfilesPage.tsx` and only render that page when `canUseLocalKeychain` is true.
3. If it performs local draft or sync queue work, call it only when `isDesktopRuntime()` is true.
4. If it is launcher/update behavior, keep it inside `launcher/*` or `remote/desktopBridge.ts`.

- [ ] **Step 4: Run boundary and type checks**

Run:

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm test -- web-build-boundary.test.ts web-mode.test.tsx web-downloads.test.ts runtime-platform.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new
 git add juxin-ai-assistant/apps/desktop/tests/web-build-boundary.test.ts \
  juxin-ai-assistant/apps/desktop/src
 git commit -m "test(ai-assistant): enforce web tauri import boundary"
```

---

## Task 8: Web Deployment Documentation

**Files:**

- Create: `juxin-ai-assistant/docs/web-deployment.md`
- Test: manual documentation review

**Interfaces:**

- Consumes: final settings names from Tasks 5 and 6.
- Produces: copy-pastable deployment checklist for public Web deployment.

- [ ] **Step 1: Create deployment documentation**

Create `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/docs/web-deployment.md`:

````md
# 聚信 AI 助手 Web 版部署说明

## 目标

让员工通过公网 HTTPS 地址访问聚信 AI 助手。Web 版只开放给已通过统一登录授权的聚信内部员工和管理员。

## 构建

前端构建：

```bash
cd apps/desktop
npm run build:web
```

后端启动前确认静态目录：

```bash
WEB_SPA_ENABLED=true
WEB_STATIC_DIR=/opt/juxin-ai-assistant/web
PUBLIC_URL=https://ai.example.com
CORS_ORIGINS=https://ai.example.com
AUTH_PUBLIC_URL=https://auth.example.com
AUTH_SERVICE_URL=http://auth:5180
```

## 必需安全配置

- 全站必须使用 HTTPS。
- `CORS_ORIGINS` 只能配置正式 Web 域名。
- `AUTH_DEV_BYPASS=false`。
- `PROMPT_CENTER_RUNTIME_TOKEN`、`CONTENT_ENCRYPTION_KEY`、`AUDIT_HASH_SALT`、`AI_LOCAL_BINDING_SECRET` 必须通过环境变量配置。
- 不允许把真实密钥写入 `.env.example`、文档、日志或前端构建产物。

## Nginx / Ingress 路由

- `/` 指向 FastAPI 或静态资源服务。
- `/api/*` 指向 FastAPI。
- `/assets/*` 指向 Web 静态资源。
- 不开放服务器真实上传目录和导出目录。

## 验收

1. 未登录访问 `/` 后进入统一登录流程。
2. 未登录访问 `/api/ai/session` 返回 `401`。
3. 登录员工可以进入工作台。
4. 普通员工访问管理接口返回 `403`。
5. 可以完成聊天生成。
6. 可以上传当前附件。
7. 可以导出并下载 Word。
8. 下载链接不暴露服务器真实路径。
9. 日志不包含完整 API Key。
10. 桌面端打包脚本仍可用。
````

- [ ] **Step 2: Verify documentation has no secrets or placeholders**

Run:

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant
rg -n "sk-|AKIA|BEGIN PRIVATE KEY" docs/web-deployment.md || true
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new
 git add juxin-ai-assistant/docs/web-deployment.md
 git commit -m "docs(ai-assistant): add web deployment checklist"
```

---

## Final Verification

Run the fastest relevant checks first:

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm test -- runtime-platform.test.ts session.test.tsx web-mode.test.tsx web-downloads.test.ts web-build-boundary.test.ts
npm run typecheck
npm run build:web
```

Then backend checks:

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
pytest tests/test_static_web.py tests/test_web_public_security.py tests/test_auth.py tests/test_secret_boundary.py -q
```

If those pass, run existing focused user-flow tests:

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm test -- employee-flow.test.tsx chat-page.test.tsx task-run.test.tsx knowledge-page.test.tsx
```

## Acceptance Criteria

- Browser Web build succeeds with `npm run build:web`.
- Web mode does not render desktop updater, local model keychain settings, or local file-open controls.
- Desktop mode keeps existing desktop controls.
- Web mode uses cookie-based unified login and does not attach desktop SSO bearer tokens from `sessionStorage`.
- Unauthenticated Web API access returns `401`.
- Untrusted write origins return `403`.
- Word export downloads through browser without exposing server file paths.
- Static SPA serving returns `index.html` for browser routes and does not capture `/api/*` routes.
- Existing desktop tests and typecheck continue to pass.
- No real secrets are added to docs, code, logs, or tests.

## Execution Notes

- Do not commit local SQLite databases.
- Do not commit `.env` or generated production config.
- Keep each task as a separate commit.
- If any existing unrelated test fails, record it and do not fix unrelated behavior in this Web-version branch.
