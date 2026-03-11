# 培训考试系统 OSS 受管视频设计

**日期：** 2026-03-11

## 目标

为 `train-exam` 增加阿里云 OSS 受管视频能力，满足以下目标：

- 管理端可将培训视频直接上传到 OSS，而不是先传到后端本地磁盘。
- 学员仍通过系统内置播放器观看视频，不退化为普通外链跳转。
- OSS 视频继续支持现有“强制播放 / 禁止快进 / 进度校验”闭环。
- 保留现有本地上传与普通外链能力，避免一次性重构所有资源链路。

## 现状

当前培训资源有两种来源模式：

- `upload`：通过后端上传接口接收文件，后端落盘到 `RESOURCE_ROOT`。
- `external`：仅保存 `source_url`，前端直接打开外链。

当前实现中，“强制播放”只允许 `video + upload` 资源使用；`external` 视频不进入系统 `<video>` 播放器，也就无法形成可信的防快进闭环。

## 方案选择

本次采用方案 A：`OSS 私有存储 + 前端直传 + 后端签名播放`。

### 选择原因

- 直传 OSS 可以绕开当前后端中转与本地磁盘落地，减少服务端带宽和磁盘压力。
- 视频仍通过系统播放接口进入内置播放器，现有强制播放与学习进度校验逻辑可以保留。
- OSS 桶可保持私有，不暴露长期公网直链。

### 放弃的方案

- 后端中转到 OSS：不能解决浏览器到后端这一段的大文件上传瓶颈。
- 继续把 OSS 当普通外链：无法稳定控制播放器，也无法可信防快进。

## 范围

### 本次范围内

- 为视频上传资源增加 `OSS` 存储后端。
- 新增 OSS 直传初始化与完成确认接口。
- 为 OSS 视频增加受权播放签名逻辑。
- 保留现有强制播放、学习进度、后端跳跃校验。
- 更新前端资源管理界面与播放器接入。

### 本次范围外

- 不迁移已有本地视频到 OSS。
- 不接入阿里云转码、点播、截图、字幕等媒体能力。
- 不扩展普通 `external` 外链为可防快进模式。
- 首期不支持非标准浏览器视频格式的自动转码兜底。

## 总体架构

### 上传链路

1. 管理员创建课程资源，选择：
   - `resource_type = video`
   - `source_mode = upload`
   - `storage_backend = oss`
2. 前端调用 `POST /api/train-exam/resources/:id/oss-upload-init`。
3. 后端校验资源与权限，生成受控 `object_key`，返回短时上传凭证。
4. 浏览器直接将文件上传到 OSS。
5. 前端上传成功后调用 `POST /api/train-exam/resources/:id/oss-upload-complete`。
6. 后端通过 OSS SDK 校验对象存在、大小、类型与前缀合法，写回资源元数据并标记为 `ready`。

### 播放链路

1. 学员打开培训播放器。
2. 前端仍请求系统资源流接口 `/api/train-exam/resources/:id/stream`。
3. 后端校验课程可读权限、资源状态和播放条件。
4. 若资源存储在 OSS，后端生成短时签名播放 URL，并通过跳转或受控返回交给前端 `<video>` 使用。
5. 前端继续复用现有播放器事件处理：
   - 禁止拖动超前进度
   - 限制播放倍率
   - 周期上报 `last_position_seconds / progress_percent`
6. 后端继续复用现有进度跳跃校验，阻断伪造快进。

## 数据模型设计

在现有 `te_course_resources` 上做增量扩展，不拆表。

### 保留现有字段

- `source_mode`
  - `upload`
  - `external`
- `storage_path`
  - 仅本地文件使用
- `source_url`
  - 仅普通外链使用
- `mime_type`
- `file_size`
- `duration_seconds`
- `force_watch`

### 新增字段

- `storage_backend VARCHAR(16) NOT NULL DEFAULT 'local'`
  - `local | oss | external`
- `object_key VARCHAR(512) NULL`
- `object_etag VARCHAR(128) NULL`
- `upload_status VARCHAR(16) NOT NULL DEFAULT 'pending'`
  - `pending | uploading | ready | failed`

### 语义约束

- 本地视频：
  - `source_mode = upload`
  - `storage_backend = local`
  - `storage_path != NULL`
- OSS 受管视频：
  - `source_mode = upload`
  - `storage_backend = oss`
  - `object_key != NULL`
  - `upload_status = ready`
- 普通外链视频：
  - `source_mode = external`
  - `storage_backend = external`
  - `source_url != NULL`

### 强制播放规则

- 允许：
  - `resource_type = video`
  - `source_mode = upload`
  - `storage_backend in (local, oss)`
- 不允许：
  - `source_mode = external`

这样可以保持“受管上传资源才支持强制播放”的业务边界，同时把 OSS 视频纳入受管范围。

## API 设计

### 复用接口

#### `POST /api/train-exam/resources`

新增可选字段：

- `storage_backend`

规则：

- `source_mode = upload` 时，视频可选 `local / oss`。
- `source_mode = external` 时，后端强制写为 `external`。

#### `PUT /api/train-exam/resources/:id`

允许编辑 `storage_backend`。

切换后端时需清理不匹配的字段：

- `oss -> local`：清理 `object_key / object_etag`
- `local -> oss`：清理 `storage_path`
- 切到 `external`：清理上传相关元数据和挂起任务

#### `POST /api/train-exam/resources/:id/upload`

保留为本地上传接口，但仅允许 `storage_backend = local` 使用。

若资源为 `oss`，后端返回明确错误，引导前端改走 OSS 直传流程。

#### `GET /api/train-exam/resources/:id/stream`

- `local`：保持当前本地文件流式返回。
- `oss`：后端校验权限后生成短时签名播放 URL。
- `external`：保持当前外链跳转语义。

#### `GET /api/train-exam/resources/:id/playability`

新增 `oss` 检查：

- `upload_status` 是否为 `ready`
- 对象是否存在
- MIME 是否允许

### 新增接口

#### `POST /api/train-exam/resources/:id/oss-upload-init`

用途：初始化浏览器直传。

返回内容建议包括：

- `object_key`
- `upload_url`
- `headers`
- `expires_at`
- `max_file_size`
- `allowed_mime`

约束：

- 仅视频资源使用
- 仅 `source_mode = upload` 且 `storage_backend = oss`
- 首期仅允许标准 `MP4(H.264/AAC)`，前端文件选择时即提示

#### `POST /api/train-exam/resources/:id/oss-upload-complete`

用途：上传成功后的服务端确认。

前端提交：

- `object_key`
- `etag`
- `file_size`
- `mime_type`
- `original_name`

后端必须再次执行服务端校验：

- 对象存在
- Key 前缀合法
- 大小和类型合理
- 对应资源仍处于可上传状态

确认成功后，写入资源元数据并将 `upload_status` 标记为 `ready`。

## OSS 关键约束

### 桶策略

- 使用私有桶，不提供永久公网地址。
- 上传和播放都通过短时签名完成。

### Key 规范

建议统一前缀：

`train-exam/course-{courseId}/resource-{resourceId}/{uuid}.mp4`

约束目标：

- 易于按课程或资源排查对象
- 防止前端伪造任意对象路径
- 为后续后台迁移脚本预留稳定路径规范

### 有效期

- 上传签名：短时有效，建议 5 到 10 分钟。
- 播放签名：更短，建议 2 到 5 分钟。

## 前端设计

### 资源创建/编辑

在视频 `source_mode = upload` 场景下新增“存储位置”选择：

- 本地
- 阿里云 OSS

交互规则：

- `external` 仍只显示外链 URL 输入框。
- `upload + local` 保持现有上传按钮与本地上传逻辑。
- `upload + oss` 时，上传按钮改为：
  - 初始化直传
  - 浏览器上传到 OSS
  - 完成后回调后端确认

### 播放器

播放器继续使用当前系统内 `<video>` 组件。

需要调整的点：

- 不能再把 `external` 以外的所有视频都简单映射为本地文件流。
- `oss` 资源也应走系统自己的播放入口。
- 强制播放 UI 与现有行为保持一致，不向学员暴露“这是 OSS 地址”的概念。

## 错误处理

### 上传初始化失败

- 权限不足
- 资源不存在
- 资源类型错误
- 资源已处于不可覆盖状态

前端提示“无法初始化 OSS 上传，请检查资源状态后重试”。

### 浏览器上传失败

- 资源状态保持 `pending / uploading / failed`
- 不允许进入可播放状态
- 前端允许重试，不自动回退为本地上传

### 完成确认失败

- 后端以 OSS 校验结果为准
- 校验失败后写入 `failed`
- 防止前端单方面声称“上传成功”

### 播放失败

- 若签名生成失败或对象缺失，播放器显示资源不可播放提示
- 前端重新请求 `/stream` 可获取新的签名地址

## 安全设计

- 后端只信任自己生成的 `object_key`，不信任前端任意传值。
- 播放前必须继续走系统鉴权和课程可读校验。
- 强制播放不可只依赖前端；继续保留后端对 `last_position_seconds / progress_percent` 的跳跃校验。
- 不把 OSS 视为普通外链，避免学员直接保存长期链接绕过系统界面。

## 兼容性与取舍

### 首期取舍

- 首期仅支持标准 MP4。
- 暂不接入云转码。
- 暂不支持从浏览器端直接检测复杂编码兼容性。

### 原因

- 当前目标是先解决直传与受控播放，不把范围扩散到媒体处理系统。
- 现有后端本地视频已包含格式校验与转码逻辑；OSS 首期先做“上传标准格式”的窄闭环，风险最低。

## 迁移策略

- 老的 `local upload` 资源继续按原逻辑运行。
- 老的 `external` 资源继续按原逻辑跳转打开。
- 本次只为新建或新编辑的视频资源开放 `OSS`。
- 历史资源迁移到 OSS 不纳入本次交付。

## 测试策略

### 后端

- 字段迁移与默认值校验
- `local / oss / external` 三种存储后端行为校验
- OSS 初始化与完成确认接口的权限、状态流转、错误分支
- `/stream` 与 `/playability` 在 OSS 场景下的分支行为
- 强制播放在 `upload + oss` 场景下仍生效

### 前端

- 创建/编辑资源时能正确切换 `local / oss / external`
- OSS 上传成功、失败、重试交互正确
- OSS 视频进入系统播放器，不退化为外链按钮

### 手工验收

- 上传一个标准 MP4 到 OSS 并成功播放
- 开启强制播放后拖动进度被前端阻止
- 伪造一次超前进度上报被后端拒绝
- 播放签名过期后重新请求仍可继续播放

## 实施建议

实现阶段建议坚持小步提交：

1. 先补数据库字段与后端状态机
2. 再补 OSS 初始化/确认接口
3. 再改播放接口
4. 最后接前端上传与播放器
5. 补 OpenAPI、部署配置与验收文档

这样可以保证每一步都可单独测试和回滚。
