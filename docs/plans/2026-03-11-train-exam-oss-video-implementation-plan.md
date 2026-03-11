# Train-Exam OSS Video Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 `train-exam` 增加阿里云 OSS 受管视频能力，支持浏览器直传、系统内受控播放，以及 OSS 视频下的强制播放与进度校验。

**Architecture:** 保留现有 `source_mode=upload/external` 语义，在 `upload` 资源下新增 `storage_backend=local/oss` 区分本地与 OSS 存储。上传链路新增 `oss-upload-init` 与 `oss-upload-complete` 两个接口，播放链路继续复用 `/stream` 与现有播放器事件，只在后端对 OSS 资源生成短时签名 URL。

**Tech Stack:** Node.js, Express, MySQL, multer, React, Vite, Vitest, 阿里云 OSS SDK

---

### Task 1: 扩展资源存储元数据与后端基础校验

**Files:**
- Modify: `train-exam/backend/src/db.js`
- Modify: `train-exam/backend/src/index.js`
- Create: `train-exam/backend/tests/resource-storage-oss.test.js`

**Step 1: Write the failing test**

```js
import { describe, expect, it } from 'vitest';

describe('resource storage backend normalization', () => {
  it('allows upload video resources to use oss backend', () => {
    expect(normalizeStorageBackend('oss', { sourceMode: 'upload' })).toBe('oss');
  });

  it('forces external resources to external backend', () => {
    expect(resolveStorageBackend({ sourceMode: 'external', requested: 'oss' })).toBe('external');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd train-exam/backend && npx vitest run tests/resource-storage-oss.test.js`

Expected: FAIL with missing storage-backend helpers or unknown fields.

**Step 3: Write minimal implementation**

```js
const ALLOWED_STORAGE_BACKENDS = new Set(['local', 'oss', 'external']);

const normalizeStorageBackend = (value, { sourceMode } = {}) => {
  const key = String(value || '').trim().toLowerCase();
  if (sourceMode === 'external') return 'external';
  if (key === 'oss') return 'oss';
  return 'local';
};
```

同时在 `te_course_resources` 增加：

- `storage_backend`
- `object_key`
- `object_etag`
- `upload_status`

并在资源创建、编辑、详情输出中返回这些字段。

**Step 4: Run test to verify it passes**

Run: `cd train-exam/backend && npx vitest run tests/resource-storage-oss.test.js`

Expected: PASS

**Step 5: Commit**

```bash
git add train-exam/backend/src/db.js train-exam/backend/src/index.js train-exam/backend/tests/resource-storage-oss.test.js
git commit -m "feat: add oss storage metadata for train exam resources"
```

### Task 2: 增加 OSS 配置与签名工具

**Files:**
- Modify: `train-exam/backend/package.json`
- Modify: `train-exam/backend/package-lock.json`
- Create: `train-exam/backend/src/oss-utils.js`
- Create: `train-exam/backend/tests/oss-utils.test.js`
- Modify: `docker-compose.yml`

**Step 1: Write the failing test**

```js
import { describe, expect, it } from 'vitest';
import { buildManagedOssObjectKey, validateOssConfig } from '../src/oss-utils.js';

describe('oss utils', () => {
  it('builds a scoped object key per course/resource', () => {
    const key = buildManagedOssObjectKey({ courseId: 12, resourceId: 34, ext: '.mp4' });
    expect(key).toMatch(/^train-exam\/course-12\/resource-34\/.+\.mp4$/);
  });

  it('rejects incomplete oss configuration', () => {
    expect(() => validateOssConfig({ bucket: '', region: '' })).toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd train-exam/backend && npx vitest run tests/oss-utils.test.js`

Expected: FAIL because `oss-utils.js` does not exist.

**Step 3: Write minimal implementation**

```js
const OSS = require('ali-oss');

const buildManagedOssObjectKey = ({ courseId, resourceId, ext }) =>
  `train-exam/course-${courseId}/resource-${resourceId}/${crypto.randomUUID()}${ext}`;
```

在 `oss-utils.js` 中集中封装：

- 环境变量读取
- OSS 客户端初始化
- 对象 Key 生成
- 上传签名参数生成
- 播放签名 URL 生成
- 对象 `HEAD` 校验

同时在 `docker-compose.yml` 添加占位环境变量，例如：

- `OSS_ENABLED`
- `OSS_REGION`
- `OSS_BUCKET`
- `OSS_ACCESS_KEY_ID`
- `OSS_ACCESS_KEY_SECRET`
- `OSS_STS_ROLE_ARN` 或等价凭据方案

**Step 4: Run test to verify it passes**

Run: `cd train-exam/backend && npx vitest run tests/oss-utils.test.js`

Expected: PASS

**Step 5: Commit**

```bash
git add train-exam/backend/package.json train-exam/backend/package-lock.json train-exam/backend/src/oss-utils.js train-exam/backend/tests/oss-utils.test.js docker-compose.yml
git commit -m "feat: add train exam oss config helpers"
```

### Task 3: 实现 OSS 直传初始化与完成确认接口

**Files:**
- Modify: `train-exam/backend/src/index.js`
- Modify: `train-exam/api/openapi/train-exam-v1.yaml`
- Modify: `train-exam/backend/tests/smoke.e2e.test.js`

**Step 1: Write the failing test**

```js
it('initializes and confirms oss upload for upload video resources', async () => {
  const resource = await createVideoResource({ source_mode: 'upload', storage_backend: 'oss' });

  const init = await api.post(`/api/train-exam/resources/${resource.id}/oss-upload-init`, {});
  expect(init.status).toBe(200);
  expect(init.data.object_key).toContain(`resource-${resource.id}`);

  mockOssHeadObject({ key: init.data.object_key, size: 1024, mime: 'video/mp4' });
  const complete = await api.post(`/api/train-exam/resources/${resource.id}/oss-upload-complete`, {
    object_key: init.data.object_key,
    etag: 'mock-etag',
    file_size: 1024,
    mime_type: 'video/mp4',
    original_name: 'lesson.mp4',
  });
  expect(complete.status).toBe(200);
  expect(complete.data.upload_status).toBe('ready');
});
```

**Step 2: Run test to verify it fails**

Run: `cd train-exam/backend && npx vitest run tests/smoke.e2e.test.js -t "initializes and confirms oss upload for upload video resources"`

Expected: FAIL with `404` or missing field validation.

**Step 3: Write minimal implementation**

```js
app.post('/api/train-exam/resources/:id/oss-upload-init', requireContentWriter, asyncHandler(async (req, res) => {
  const resource = await getManagedOssVideoResource(req.params.id);
  const objectKey = buildManagedOssObjectKey({
    courseId: resource.course_id,
    resourceId: resource.id,
    ext: '.mp4',
  });
  const signed = await createManagedOssUploadSignature({ objectKey, mimeType: 'video/mp4' });
  await markResourceUploadState({ resourceId: resource.id, uploadStatus: 'uploading', objectKey });
  res.json(signed);
}));
```

完成确认接口必须：

- 校验资源仍为 `upload + oss + video`
- 用 OSS SDK 做 `HEAD Object`
- 对比 `object_key / file_size / mime_type`
- 只有校验通过才把资源状态写为 `ready`

**Step 4: Run test to verify it passes**

Run: `cd train-exam/backend && npx vitest run tests/smoke.e2e.test.js -t "initializes and confirms oss upload for upload video resources"`

Expected: PASS

**Step 5: Commit**

```bash
git add train-exam/backend/src/index.js train-exam/api/openapi/train-exam-v1.yaml train-exam/backend/tests/smoke.e2e.test.js
git commit -m "feat: add oss upload init and complete endpoints"
```

### Task 4: 扩展播放与可播放性检查到 OSS 受管视频

**Files:**
- Modify: `train-exam/backend/src/index.js`
- Create: `train-exam/backend/tests/resource-stream-oss.test.js`

**Step 1: Write the failing test**

```js
import { describe, expect, it } from 'vitest';

describe('resource stream with oss backend', () => {
  it('returns a short-lived signed playback url for managed oss videos', async () => {
    const payload = await requestManagedOssStream({ forceWatch: true, uploadStatus: 'ready' });
    expect(payload.redirect_url).toContain('OSSAccessKeyId=');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd train-exam/backend && npx vitest run tests/resource-stream-oss.test.js`

Expected: FAIL because `/stream` only knows local file and external URL branches.

**Step 3: Write minimal implementation**

```js
if (normalizeSourceMode(resource.source_mode) === 'upload' && normalizeStorageBackend(resource.storage_backend) === 'oss') {
  if (normalizeUploadStatus(resource.upload_status) !== 'ready') throw appError('视频尚未上传完成', 409);
  const redirectUrl = await createManagedOssPlaybackUrl({ objectKey: resource.object_key });
  return res.json({ redirect_url: redirectUrl, mode: 'oss' });
}
```

同时更新 `/playability`：

- `upload_status != ready` 时不可播放
- `object_key` 不存在时返回明确原因

并把“强制播放仅支持上传视频资源”的规则改成“仅支持受管上传视频资源”，允许 `upload + oss`。

**Step 4: Run test to verify it passes**

Run: `cd train-exam/backend && npx vitest run tests/resource-stream-oss.test.js`

Expected: PASS

**Step 5: Commit**

```bash
git add train-exam/backend/src/index.js train-exam/backend/tests/resource-stream-oss.test.js
git commit -m "feat: support managed oss playback for train exam videos"
```

### Task 5: 接入前端 OSS 上传流程与系统内播放器

**Files:**
- Modify: `train-exam/frontend/src/App.jsx`
- Modify: `train-exam/frontend/src/App.css`

**Step 1: Write the failing behavior check**

```js
// Manual expectation:
// 1. Create a video resource with source_mode=upload and storage_backend=oss
// 2. Upload a .mp4 file
// 3. Open player and confirm it still uses the in-app modal player
// 4. Seek ahead while force_watch=true and expect rejection
```

**Step 2: Run the current UI flow to verify it fails**

Run: `cd train-exam/frontend && npm run build`

Expected: PASS build, but the current UI has no OSS selector, no OSS upload flow, and external/open-url logic would not support managed OSS playback.

**Step 3: Write minimal implementation**

```jsx
<select value={resourceForm.storage_backend} onChange={...}>
  <option value="local">本地</option>
  <option value="oss">阿里云 OSS</option>
</select>
```

实现点：

- 创建/编辑资源表单新增 `storage_backend`
- 当 `source_mode=upload && storage_backend=oss` 时：
  - 上传按钮改走 `oss-upload-init`
  - 浏览器 `PUT`/表单直传 OSS
  - 成功后调用 `oss-upload-complete`
- 学习播放器把 `upload + oss` 资源视作系统内受管视频，不走“打开外链视频”按钮
- 保持现有 `onSeeking / onTimeUpdate / onRateChange` 逻辑不变

**Step 4: Run verification**

Run: `cd train-exam/frontend && npm run build`

Expected: PASS

再执行手工验证：

- 选择 `OSS` 上传一个标准 MP4
- 开启强制播放
- 在播放器内拖动进度，预期出现“不可拖动进度快进”提示

**Step 5: Commit**

```bash
git add train-exam/frontend/src/App.jsx train-exam/frontend/src/App.css
git commit -m "feat: add managed oss upload flow to train exam frontend"
```

### Task 6: 完成回归验证与文档补充

**Files:**
- Modify: `docs/manuals/train-exam-user-manual.md`
- Modify: `README.md`
- Modify: `docs/plans/2026-03-11-train-exam-oss-video-design.md`

**Step 1: Write the missing verification checklist**

```md
- OSS 视频可上传并变为 ready
- OSS 视频仍在系统播放器内播放
- force_watch=true 时前后端都能阻止快进
- external 视频仍不允许启用强制播放
```

**Step 2: Run backend regression**

Run: `cd train-exam/backend && npm test`

Expected: PASS

Run: `cd train-exam/backend && npm run test:smoke`

Expected: PASS

**Step 3: Run frontend regression**

Run: `cd train-exam/frontend && npm run build`

Expected: PASS

**Step 4: Update docs**

补充：

- OSS 所需环境变量
- 资源创建时如何选择 `本地 / 阿里云 OSS`
- 为什么普通外链视频仍不支持强制播放

**Step 5: Commit**

```bash
git add docs/manuals/train-exam-user-manual.md README.md docs/plans/2026-03-11-train-exam-oss-video-design.md
git commit -m "docs: document managed oss video flow for train exam"
```
