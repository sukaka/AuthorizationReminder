# Tender 章节生成强 Schema 设计

## 背景

当前 `BID_COMPOSE_DRAFT` 已能返回章节数组，但 AI 输出仍是自由形态：

- 标题可能漂移
- 章节顺序可能变化
- 关键章节可能缺失
- 直接进入装配会放大不稳定性

因此 `GAP-0008` 的关键不是再加一层 prompt，而是在装配前强制走一层固定 schema 校验。

## 目标

1. 为 `SERVICE / PRODUCT` 两类项目定义固定章节骨架
2. AI 章节先映射到固定 schema
3. 缺失章节自动回退到规则骨架
4. 返回显式 `chapter_schema_validation`
5. 只有通过 schema 归一化后的章节才能进入 clause route 与 Word 装配

## 非目标

- 不要求 AI 一次性完美命中所有章节标题
- 不引入完整 JSON Schema 校验库
- 不改变现有章节生成 prompt 存储模型

## 方案

新增 helper `draft-schema.js`：

- `buildDraftChapterSchema`
- `normalizeDraftChaptersToSchema`

### SERVICE 固定章节

- `封面`
- `目录`
- `投标邀请`
- `投标人须知`
- `采购需求`
- `评标方法与评标标准`
- `服务方案框架`
- `偏离表`
- `合同主要条款及格式`
- `投标文件格式`

### PRODUCT 固定章节

- `封面`
- `目录`
- `投标邀请`
- `投标人须知`
- `采购需求与技术参数`
- `评标方法与评分响应`
- `偏离表`
- `合同主要条款及格式`
- `投标文件格式`

### 归一化规则

- AI 章节按 alias 匹配到 schema slot
- 未命中的 required slot 用 baseline chapter 兜底
- 未匹配的 AI 章节保留为 extra chapter，避免内容丢失
- 输出 validation：
  - `required_keys`
  - `missing_required_keys`
  - `used_ai_keys`
  - `fallback_keys`
  - `extra_ai_count`
  - `valid`

## 接入点

在 `/api/tender/bids/generate/jobs/:id/create` 中：

1. 先生成 baseline chapters
2. 把 `draft_schema` 作为输入提示给 AI
3. AI 返回 `chapters`
4. `normalizeDraftChaptersToSchema` 做归一化和兜底
5. 再进入 clause route 和 Word layout

## 验收

- helper 单测覆盖 service/product 两套 schema
- create 接口返回 `chapter_schema_validation`
- full tender smoke 通过
