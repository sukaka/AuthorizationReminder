# 投标系统第1步设计：条款数据契约与分类路由

## 1. 目标与范围

本设计只覆盖第一优先级能力：

1. 统一“条款数据契约”（Clause Contract）
2. 建立“条款分类路由表”（Clause Routing）

不在本轮范围：

- 评分优化闭环写回
- 偏离表判定引擎重构
- 深度一致性规则实现

## 2. 与现状对齐（当前已存在）

当前系统已具备以下基础对象：

- `tender_requirement_registry`
- `tender_evidence_registry`
- `tender_draft_section_registry`
- `tender_draft_check_runs` / `tender_draft_check_issues`
- `tender_score_coverage_matrix` / `tender_score_optimization_records`

当前不足在于：

- `requirement_registry` 字段语义偏“生成结果”，不是完整“条款契约”
- 缺少标准化路由字段（如 `response_mode`、`need_exact_quote`）
- 条款类别与后续处理模块耦合不够明确

## 3. 统一条款数据契约（Clause Contract V2）

### 3.1 单条款标准结构

```json
{
  "clause_id": "C-000001",
  "job_id": 123,
  "bid_category": "SERVICE",
  "chapter_key": "BIDDER_INSTRUCTION",
  "chapter_title": "投标人须知",
  "source_location": {
    "page_no": "12",
    "line_no": "233",
    "table_no": "",
    "paragraph_no": "19"
  },
  "source_text": "投标人须提供近三年类似项目业绩不少于3个",
  "normalized_text": "近三年类似项目业绩不少于3个",
  "clause_type": "PERFORMANCE_REQUIREMENT",
  "requirement_type": "QUALIFICATION",
  "mandatory": true,
  "scoring_related": true,
  "full_score": 3,
  "response_mode": "EVIDENCE_BINDING",
  "need_attachment": true,
  "need_exact_quote": false,
  "need_parameter_compare": false,
  "risk_level": "HIGH",
  "response_strategy": "从案例库提取近三年同类型项目3个并附合同关键页",
  "route": {
    "target_module": "EVIDENCE_MATCHER",
    "route_key": "QUALIFICATION_PERFORMANCE"
  },
  "audit": {
    "extract_model": "qwen3.5",
    "extract_confidence": 0.87,
    "manual_confirmed": false
  }
}
```

### 3.2 字段字典（必填）

- `clause_id`：条款唯一ID（作全链路关联键）
- `source_text`：原文（可审计）
- `chapter_key`/`chapter_title`：所属章节
- `clause_type`：细粒度条款类型
- `mandatory`：是否强制
- `scoring_related`：是否评分相关
- `response_mode`：响应方式
- `risk_level`：风险级别
- `response_strategy`：建议响应策略

### 3.3 枚举建议

- `requirement_type`：`QUALIFICATION|INVALID_BID|BUSINESS|TECH_PARAM|SCORING|FORMAT|ATTACHMENT`
- `response_mode`：`EXACT_QUOTE|EVIDENCE_BINDING|PARAM_COMPARE|TEMPLATE_FILL|AI_DRAFT|MANUAL_ONLY`
- `risk_level`：`HIGH|MEDIUM|LOW`

## 4. 条款分类路由表（Routing）

| requirement_type | clause_type 示例 | response_mode | target_module | 说明 |
| --- | --- | --- | --- | --- |
| QUALIFICATION | PERFORMANCE_REQUIREMENT | EVIDENCE_BINDING | EVIDENCE_MATCHER | 自动匹配资质/业绩材料 |
| INVALID_BID | SIGNATURE_SEAL_INVALID | TEMPLATE_FILL | RISK_CHECKER | 重点做废标风险门禁 |
| BUSINESS | PAYMENT_TERM | EXACT_QUOTE | SECTION_GENERATOR | 优先引用原文并做最小改写 |
| TECH_PARAM | PARAM_MANDATORY | PARAM_COMPARE | DEVIATION_GENERATOR | 参数逐条比对生成偏离 |
| SCORING | IMPLEMENT_PLAN_SCORE | AI_DRAFT | SCORE_OPTIMIZER | 面向得分点定向补强 |
| FORMAT | TOC_REQUIREMENT | TEMPLATE_FILL | WORD_ASSEMBLER | 模板槽位和目录规则 |
| ATTACHMENT | AUTHORIZATION_ORIGINAL | EVIDENCE_BINDING | EVIDENCE_MATCHER | 附件必备项绑定证据 |

## 5. 与现有数据库兼容策略

## 5.1 V1 兼容（不改表结构立即落地）

将 V2 新字段先放入 `tender_requirement_registry.source_json`，并保持现有列写入：

- 现有列继续写：`requirement_code`/`requirement_type`/`title`/`requirement_text`/`risk_level`
- V2 字段写入 `source_json`：`response_mode`/`mandatory`/`scoring_related`/`route`/`source_location` 等

优点：

- 不破坏当前接口与已有数据
- 可先完成路由执行，不阻塞研发

## 5.2 V2 演进（后续迁移）

后续再增列并回填：

- `mandatory` TINYINT
- `scoring_related` TINYINT
- `response_mode` VARCHAR(32)
- `need_attachment` TINYINT
- `need_exact_quote` TINYINT
- `route_module` VARCHAR(64)
- `route_key` VARCHAR(64)

## 6. 接口接入点设计

### 6.1 Analyze 阶段

- 输入：解析后的章节、表格、评分项、风险项
- 输出新增：`clause_registry_v2`（数组）
- 落库：`tender_requirement_registry`（V1列 + `source_json` 承载V2）

### 6.2 Create 阶段

- 读取 `clause_registry_v2`
- 按 `response_mode` 调用不同处理器：
  - `EVIDENCE_BINDING` -> 企业资料匹配
  - `PARAM_COMPARE` -> 偏离表生成
  - `AI_DRAFT` -> 章节生成/评分补强
  - `TEMPLATE_FILL` -> 模板槽位填充

### 6.3 Check / Score-Optimize 阶段

- `check`：使用 `mandatory`、`need_exact_quote`、`response_mode` 做更精细规则校验
- `score-optimize`：优先消费 `scoring_related=true` 的条款集

## 7. 验收标准（第1步）

以下全部满足才算第1步完成：

1. Analyze 响应中可返回统一条款列表（含路由字段）
2. 每条款可追溯原文位置与章节
3. Create 可基于 `response_mode` 分流处理（至少支持 3 类）
4. Check 至少新增 2 类依赖契约字段的规则
5. 单测覆盖条款契约构建与路由分发逻辑

## 8. 测试清单（实现前置）

- `clause-contract.test.js`
  - 校验字段完整性
  - 校验枚举合法性
- `clause-routing.test.js`
  - 给定条款类型，能得到确定路由模块
- `smoke.e2e.test.js`
  - analyze 返回 `clause_registry_v2`
  - create/check/score-optimize 可消费该契约

## 9. 风险与约束

- 风险1：字段增多导致模型输出不稳定  
  处理：先做最小必填 + 默认值兜底

- 风险2：历史数据没有新字段  
  处理：读取层增加兼容归一化函数，允许从 `source_json` 回填

- 风险3：路由误判影响生成质量  
  处理：高风险条款默认进入人工复核队列

