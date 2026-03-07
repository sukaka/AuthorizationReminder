# 投标系统成稿级校验与评分优化设计

## 1. 背景与目标

当前 `tender` 模块已经具备以下基础能力：

- 招标文件解析
- 自有库资料带入
- 初稿章节装配
- 模板套版导出 Word
- 基础风险与评分分析

下一阶段目标不是重做生成链路，而是在现有链路上补齐两项核心能力：

1. 成稿级校验
2. 评分优化

本次设计只覆盖这两项能力，并保持与现有 `tender` 系统兼容。

## 2. 建设目标

系统建设目标如下：

- 自动解析招标文件
- 自动识别资格项、废标项、评分项、技术参数、商务条款
- 自动匹配企业现有资质、案例、产品参数、人员简历、授权文件
- 自动生成投标文件各章节初稿
- 自动生成偏离表、应答表、实施方案、售后方案、培训方案
- 自动检查漏项、冲突、前后不一致、格式风险
- 自动导出 Word 版投标文件草稿，供人工最终审核

本次设计聚焦其中最后两项，并以“结构化、可审计、可增量扩展”为约束。

## 3. 建设原则

### 3.1 原则一：AI 只做擅长的事

AI 负责：

- 招标文件理解
- 条款分类
- 内容归纳
- 方案扩写
- 高分表达优化

程序负责：

- 资料匹配
- 规则校验
- 参数比对
- 模板填充
- Word 输出

### 3.2 原则二：所有关键结果都要结构化

不让模型直接输出整篇自由文本。模型优先输出固定 JSON，程序负责：

- 结构化落库
- 章节装配
- 文档导出
- 校验执行
- 审计留痕

### 3.3 原则三：先可用，后智能

第一阶段先做到：

- 能解析
- 能匹配
- 能生成 60 分初稿
- 能自动校验

第二阶段再做到：

- 高分优化
- 风格统一
- 自动学习中标经验

### 3.4 原则四：必须可审计

每一段生成内容都必须能回答：

- 依据了哪条招标要求
- 引用了哪份企业材料
- 属于哪个模板
- 是否经过人工确认

## 4. 当前系统定位修正

当前系统中“企业资料库”按业务定义就是现在的“自有库”。从业务能力角度看，自有库到初稿生成的自动带入链路已经存在，因此本阶段不再把“企业资料库”作为主缺口处理。

当前真正需要补齐的是：

- 成稿级校验
- 评分优化

## 5. 方案比较与选型

### 5.1 方案 A：全文 AI 校对为主

优点：

- 接入快
- 开发量小

缺点：

- 结构化弱
- 审计能力弱
- 结果稳定性差
- 不符合“程序做规则校验”的原则

结论：不采用。

### 5.2 方案 B：结构化规则引擎 + Word 成稿检查器

优点：

- 与现有系统兼容
- 结构化强
- 可审计
- 可分阶段落地
- 便于后续扩展评分优化

缺点：

- 需要补一层中间数据模型
- 前后端都要扩展

结论：采用。

### 5.3 方案 C：Word DOM 深度建模优先

优点：

- 理论精度高

缺点：

- 实现成本过高
- 第一阶段容易失控

结论：暂不采用。

## 6. 总体架构

在现有生成链路之上，新增 4 个统一中间层对象：

1. `requirement_registry`
2. `evidence_registry`
3. `draft_section_registry`
4. `score_coverage_matrix`

整体流程变为：

1. 解析招标文件，形成结构化要求库
2. 冻结本次生成所使用的自有库证据快照
3. 生成初稿时同步写入章节来源链
4. 先执行结构化校验
5. 再执行 Word 成稿校验
6. 基于评分矩阵对低覆盖或弱覆盖项做定点补强
7. 输出带校验结果和优化建议的 Word 草稿

## 7. 关键中间层设计

### 7.1 requirement_registry

用途：

- 统一登记资格项、废标项、评分项、技术参数、商务条款、格式要求
- 为校验引擎和评分优化器提供标准输入

每条 requirement 至少包含：

- requirement_id
- requirement_type
- title
- requirement_text
- source chapter/page/line
- is_mandatory
- risk_level
- full_score

### 7.2 evidence_registry

用途：

- 将当前“自有库”在某次标书生成时冻结成证据快照
- 给章节装配、校验和评分优化提供统一证据引用

每条 evidence 至少包含：

- evidence_id
- evidence_type
- title
- summary
- source_type
- source_ref_id
- file_name
- fields_json
- confirmed_flag

### 7.3 draft_section_registry

用途：

- 对每个章节、段落、自动生成块、评分补强块建立来源链

每条 section 记录至少包含：

- section_id
- bid_id
- version_id
- section_title
- paragraph_no
- content_text
- content_type
- template_slot
- requirement_ids_json
- evidence_ids_json
- score_item_ids_json
- manual_confirmed_flag
- manual_edited_flag

### 7.4 score_coverage_matrix

用途：

- 将评分项与当前初稿覆盖关系标准化
- 为评分优化器提供最小闭环输入

每条记录至少包含：

- score_item_id
- requirement_id
- full_score
- target_section_id
- coverage_status
- bound_evidence_ids_json
- optimization_needed_flag
- optimization_reason

## 8. 校验引擎设计

成稿级校验拆成两层：

1. 结构化校验
2. Word 成稿校验

### 8.1 结构化校验

该层只校验结构化结果，不依赖最终 Word 排版。

第一阶段实现以下 6 类规则：

- 覆盖校验  
  检查资格项、废标项、评分项、技术参数、商务条款是否都在初稿中找到对应章节或段落。

- 证据校验  
  检查需要证明材料的条款是否绑定至少一个 `evidence_id`。

- 偏离校验  
  检查技术参数与商务条款是否存在应答记录，若存在负偏离或未响应则升级风险。

- 冲突校验  
  检查项目名称、项目编号、预算、服务期、质保期、甲方名称等关键字段在不同章节中是否一致。

- 废标风险校验  
  凡命中废标/无效/否决条款但缺响应或缺证据的，标记为高风险。

- 评分覆盖校验  
  检查每个评分项是否存在章节覆盖、证据绑定和对应应答。

### 8.2 Word 成稿校验

该层直接针对导出的 `.docx`，第一阶段只做确定性强的规则。

第一阶段实现以下 6 类规则：

- 章节顺序校验
- 标题层级校验
- 目录存在性与目录项覆盖校验
- 签章位校验
- 格式风险校验
- 关键字段一致性校验

第一阶段不做：

- 精确页码回填校验
- 全文风格主观审查
- 复杂版式语义理解

### 8.3 校验输出结构

统一输出结构化 JSON：

```json
{
  "summary": {
    "fatal_count": 2,
    "warn_count": 6,
    "score_coverage_rate": 0.68
  },
  "issues": [
    {
      "issue_id": "CHK-001",
      "level": "FATAL",
      "type": "missing_requirement",
      "title": "资格项未覆盖",
      "requirement_id": "REQ-QUAL-003",
      "section_id": null,
      "evidence_id": null,
      "source_reference": {
        "chapter": "投标人须知",
        "page_number": "12"
      },
      "suggestion": "补充营业执照与资质证书响应段落"
    }
  ]
}
```

第一阶段硬阻断项建议限定为：

- 漏资格项
- 漏废标项响应
- 漏评分项覆盖
- 关键字段冲突
- 占位符未替换
- 签章位缺失

## 9. 评分优化器设计

评分优化不做整篇重写，只做“按评分项定点补强”。

### 9.1 覆盖状态

每个评分项维护三态：

- `NONE`
- `WEAK`
- `GOOD`

优化器只处理：

- `NONE`
- `WEAK`

### 9.2 优化类型

分三档处理：

- 零覆盖补齐
- 弱覆盖增强
- 高分表达优化

限制：

- 只能基于已绑定证据补强
- 不允许编造新事实
- 不允许自由重写整篇内容

### 9.3 AI 输入

每次只处理一个评分项，输入包括：

- 评分项原文
- 当前章节上下文
- 已绑定证据
- 输出约束

### 9.4 AI 输出

AI 只输出结构化建议：

```json
{
  "optimization_type": "WEAK_TO_GOOD",
  "suggested_paragraph": "...",
  "used_evidence_ids": ["EV-STAFF-003"],
  "reason": "该段补齐了评分条款中的项目经理经验要求",
  "confidence": 0.84
}
```

### 9.5 程序职责

程序负责：

- 选择插入位置
- 校验证据引用
- 校验是否出现未证实数字或承诺
- 写入段落来源链
- 记录人工确认状态

## 10. 数据模型

本阶段建议在现有库中新增 6 组表。

### 10.1 requirement_registry

建议字段：

- id
- job_id
- requirement_code
- requirement_type
- title
- requirement_text
- chapter
- page_number
- line_number
- is_mandatory
- risk_level
- full_score
- source_json
- created_at

### 10.2 evidence_registry

建议字段：

- id
- bid_id
- evidence_code
- evidence_type
- source_type
- source_ref_id
- title
- summary
- file_name
- tags_json
- fields_json
- confirmed_flag
- created_at

### 10.3 draft_section_registry

建议字段：

- id
- bid_id
- version_id
- section_code
- section_title
- paragraph_no
- content_text
- content_type
- template_slot
- requirement_ids_json
- evidence_ids_json
- score_item_ids_json
- manual_confirmed_flag
- manual_edited_flag
- created_by
- created_at
- updated_at

### 10.4 draft_check_runs

建议字段：

- id
- bid_id
- version_id
- run_type
- summary_json
- fatal_count
- warn_count
- status
- created_by
- created_at

### 10.5 draft_check_issues

建议字段：

- id
- run_id
- issue_code
- level
- issue_type
- title
- description
- requirement_id
- evidence_id
- section_id
- source_json
- suggestion
- resolved_flag
- resolved_by
- resolved_at

### 10.6 score_coverage_matrix

建议字段：

- id
- bid_id
- version_id
- requirement_id
- score_item_title
- full_score
- target_section_id
- coverage_status
- bound_evidence_ids_json
- current_text_excerpt
- optimization_needed_flag
- optimization_reason
- created_at
- updated_at

### 10.7 score_optimization_records

建议字段：

- id
- bid_id
- version_id
- matrix_id
- optimization_type
- before_text
- suggested_text
- used_evidence_ids_json
- reason_text
- ai_task_log_id
- status
- reviewed_by
- reviewed_at
- created_at

## 11. 与当前代码的集成落点

### 11.1 analyze 成功后落 requirement_registry

落点：`/api/tender/bids/generate/analyze`

在已获得以下数据后执行：

- `finalJson`
- `stage1RiskClauses`
- `stage3MissingItems`
- `scoringItems`
- `riskItems`
- `tableSummaries`

### 11.2 create 前落 evidence_registry

落点：

- `collectOwnLibrarySnapshot()` 之后
- `buildDraftChaptersFromAnalysis()` 之前

目标：冻结本次生成使用的自有库证据快照。

### 11.3 章节生成后落 draft_section_registry

落点：

- 规则骨架章节生成后
- AI 起草章节覆盖后

目标：无论最终采用规则章节还是 AI 补写章节，都建立段落来源链。

### 11.4 Word 输出成功后执行两层校验

落点：

- DOCX 写出成功后
- 版本创建完成后

执行顺序：

1. 结构化校验
2. Word 成稿校验
3. 写入校验运行记录与问题明细

### 11.5 校验后再做评分优化

不把评分优化塞进现有 `/create` 主链路，建议新增独立接口：

- `POST /api/tender/bids/:id/check`
- `POST /api/tender/bids/:id/score-optimize`

### 11.6 数据库改动入口

所有新表优先补进当前 `tender/backend/src/db.js` 的 `createSchema()`。

## 12. 错误处理

新增能力的错误分为三类：

### 12.1 阻断错误

例如：

- requirement_registry 为空
- 评分表存在但评分项未落库
- DOCX 输出失败

处理策略：返回 `BLOCK`，禁止进入下一步。

### 12.2 可降级错误

例如：

- Word 成稿检查器解析失败
- 评分优化模型超时
- 某段无法建立来源映射

处理策略：返回 `WARN`，允许继续人工审核，但必须显示校验不完整。

### 12.3 审计错误

例如：

- 某段未写入 section registry
- 某条优化建议缺少审计关联

处理策略：记录日志并标记审计缺口，不得静默吞掉。

## 13. 测试策略

### 13.1 单元测试

覆盖：

- requirement 拆分
- evidence 规范化
- score coverage 计算
- 冲突检测
- 占位符识别

### 13.2 集成测试

覆盖：

- analyze 后 requirement_registry 落库
- create 后 evidence_registry 与 draft_section_registry 落库
- check 后校验问题落库
- optimize 后优化建议落库

### 13.3 回归样例测试

至少准备以下样例：

- 服务类招标
- 产品类招标
- 带评分表样例
- 带废标项样例
- 带格式要求样例

### 13.4 审计测试

抽查任意自动生成段落，验证是否能回溯：

- requirement_id
- evidence_id
- template_slot
- manual_confirmed_flag

## 14. 分阶段交付边界

### P0：成稿级校验底座

交付：

- requirement_registry
- evidence_registry
- draft_section_registry
- 结构化校验器
- 基础 Word 成稿校验器
- 前端校验结果展示

成功标准：

- 能识别 fatal/warn
- 能阻断严重漏项
- 能追溯每段内容来源

### P1：评分优化器

交付：

- score_coverage_matrix
- score_optimization_records
- 零覆盖/弱覆盖识别
- 定点补强建议生成
- 人工确认后写回草稿

成功标准：

- 能自动找出高分项缺口
- 能生成可审核的补强段落
- 不允许无证据编写

### P2：增强能力

交付：

- 更细的目录/页码校验
- 风格统一
- 中标经验学习
- 优化建议排序
- 自动推荐最优证据

## 15. 非目标

本次设计暂不覆盖：

- 全文自动重写
- 历史标书风格学习
- 全自动替代人工终审
- 高复杂版式的完全自动修复

## 16. 结论

本次设计坚持以下落地顺序：

1. 先建立 requirement / evidence / section 三层注册表
2. 先完成结构化校验与 Word 成稿校验
3. 再构建评分覆盖矩阵与定点补强优化
4. 全链路保留 requirement / evidence / template / human-confirm 审计链

该方案能在不推翻现有 `tender` 模块的前提下，增量实现“成稿级校验 + 评分优化”，并与既有分析、初稿生成和模板导出链路保持兼容。
