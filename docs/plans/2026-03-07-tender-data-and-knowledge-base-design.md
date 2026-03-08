# 投标系统数据建设与知识库设计

## 1. 目标

本设计用于把“投标文件自动生成系统”从在线生成链路，扩展为可持续演进的数据驱动系统。

目标不是再增加一个功能模块，而是建立一层稳定的数据底座，支撑以下能力：

- 招标文件结构化解析
- 企业资料匹配
- 历史案例复用
- 章节生成与评分优化
- 风险校验与评测

结论先行：

- 这套系统能否真正落地，关键不在模型本身，而在资料是否标准化、可检索、可打标签、可审计。
- 当前系统已具备运行态生成链路，下一步必须补“知识库层”和“数据治理层”。

## 2. 数据建设范围

本轮数据建设覆盖 5 类原始资料。

### 2.1 历史项目文件

- 已中标投标文件
- 未中标投标文件
- 招标文件
- 澄清答疑文件
- 中标通知书
- 合同

### 2.2 企业通用资料

- 营业执照
- 资质证书
- 银行资信
- 纳税/社保材料
- 售后承诺模板
- 公司介绍模板
- 组织架构说明
- 售后网点资料

### 2.3 产品资料

- 产品参数表
- 彩页
- 白皮书
- 检测报告
- 原厂授权
- 兼容性证明

### 2.4 人员资料

- 项目经理简历
- 工程师证书
- 技术团队履历
- 售后团队资料

### 2.5 案例资料

- 项目案例介绍
- 合同关键页
- 验收材料
- 用户评价

## 3. 历史资料拆分原则

### 3.1 不按“整份 Word/PDF”作为复用单元

历史标书不能只按“一个项目一个文件”存储，否则后续只能做弱检索，不能做稳定复用。

建议最小颗粒度如下：

- 项目级
- 章节级
- 子章节级
- 条款级
- 表格级
- 附件级

### 3.2 建议的拆分结果

一份历史投标文件，至少应拆成以下记录：

- 项目记录
- 章节记录
- 子章节记录
- 附件记录
- 条款记录
- 表格记录

示例：

- 项目：某单位网络安全建设项目
- 章节：技术方案、售后服务方案、培训方案、团队配置、应急保障方案
- 附件：营业执照、证书、案例合同关键页

## 4. Chunk 标准

### 4.1 检索粒度

不要按整篇检索，要按 chunk 检索。

推荐 chunk 类型：

- 一个小节
- 一个评分项对应回答
- 一个案例摘要
- 一个售后承诺段
- 一个参数块

### 4.2 Chunk 结构

每个 chunk 建议至少包含：

```json
{
  "chunk_id": "CHK-000001",
  "asset_type": "SECTION_ASSET",
  "project_id": 123,
  "section_name": "售后服务方案",
  "sub_section_name": "服务响应机制",
  "chunk_text": "提供7×24小时响应，2小时到场……",
  "tags": [
    "政府",
    "服务",
    "网络安全",
    "售后方案",
    "A"
  ],
  "source_file": "某项目投标文件.docx",
  "source_page": "P56-P58",
  "reusable_flag": true
}
```

## 5. 标签体系标准

每个素材都建议打以下标签：

- 行业：政府 / 教育 / 医疗 / 国企 / 金融 / 制造
- 项目类型：货物 / 服务 / 集成 / 运维 / 网络安全
- 产品类型：防火墙 / WAF / 日志审计 / 堡垒机 / 漏扫 / 等保服务
- 使用场景：资格响应 / 技术方案 / 售后方案 / 偏离表 / 案例
- 质量等级：A / B / C
- 是否中标来源：是 / 否
- 是否允许复用：是 / 否

补充建议字段：

- 地区
- 金额区间
- 时间范围
- 是否含原厂授权
- 是否含评分项命中

## 6. 知识库表设计建议

以下表不建议直接并入当前运行态表，而应作为独立“知识库层”建设。

### 6.1 项目主表 `kb_projects`

字段建议：

- `id`
- `project_name`
- `project_no`
- `purchaser`
- `industry_type`
- `project_type`
- `region`
- `publish_date`
- `bid_deadline`
- `result_status`
- `bid_amount`
- `remarks`

### 6.2 招标条款表 `kb_tender_clauses`

- `id`
- `project_id`
- `clause_no`
- `chapter_name`
- `source_text`
- `clause_type`
- `is_mandatory`
- `is_scoring_item`
- `score_value`
- `response_mode`
- `risk_level`
- `source_page`
- `source_position`

### 6.3 评分项表 `kb_score_items`

- `id`
- `project_id`
- `item_name`
- `full_score`
- `scoring_rule`
- `recommended_response_points`
- `priority_level`

### 6.4 企业资质表 `kb_company_qualifications`

- `id`
- `qualification_name`
- `qualification_type`
- `issuer`
- `valid_from`
- `valid_to`
- `file_path`
- `status`
- `applicable_industries`
- `keywords`

### 6.5 产品参数表 `kb_product_specs`

- `id`
- `product_name`
- `brand`
- `model`
- `category`
- `spec_key`
- `spec_value`
- `evidence_file`
- `version`
- `status`

### 6.6 历史章节素材表 `kb_section_assets`

- `id`
- `project_id`
- `section_name`
- `sub_section_name`
- `content`
- `quality_score`
- `reusable_flag`
- `applicable_scene`
- `industry_type`
- `project_type`
- `tags`

### 6.7 案例库表 `kb_project_cases`

- `id`
- `case_name`
- `customer_name`
- `industry_type`
- `project_type`
- `contract_amount`
- `sign_date`
- `core_products`
- `summary`
- `evidence_files`
- `reusable_flag`

### 6.8 人员资料表 `kb_personnel_assets`

- `id`
- `name`
- `role_type`
- `certificates`
- `years_of_experience`
- `resume_text`
- `availability_status`
- `file_path`

### 6.9 模板表 `kb_document_templates`

- `id`
- `template_name`
- `project_type`
- `document_type`
- `version`
- `structure_json`
- `word_template_path`
- `active_flag`

### 6.10 规则表 `kb_validation_rules`

- `id`
- `rule_name`
- `rule_type`
- `trigger_condition`
- `check_logic`
- `severity`
- `suggested_action`
- `active_flag`

### 6.11 生成任务表 `kb_generation_task_history`

该表可选，不建议与在线运行任务混表。

- `id`
- `project_id`
- `task_type`
- `input_payload`
- `output_payload`
- `status`
- `reviewer`
- `reviewed_at`

## 7. 与当前系统的关系

当前系统已经存在运行态表：

- `tender_bid_generate_jobs`
- `tender_requirement_registry`
- `tender_evidence_registry`
- `tender_draft_section_registry`
- `tender_score_coverage_matrix`
- `tender_score_optimization_records`
- `tender_doc_templates`

这些表负责“单次项目从解析到出稿”的在线执行。

本设计中的 `kb_*` 表负责：

- 资料沉淀
- 历史复用
- 标签检索
- embeddings 召回
- 规则积累
- 评测基线建设

原则：

- 在线运行态表不替代知识库表
- 知识库表不直接替代运行态表
- 两层通过映射与快照建立关联

## 8. AI 调用设计原则

### 8.1 不允许一个 Prompt 生成整份标书

推荐拆成多个任务：

- 项目信息提取
- 条款分类
- 评分项提取
- 材料匹配
- 按章节生成
- 偏离表生成
- 风险复核
- 输出装配

### 8.2 每个任务必须结构化输出

例如评分项提取：

```json
{
  "score_items": [
    {
      "item_name": "售后服务能力",
      "full_score": 8,
      "criteria": "根据响应时间、保障机制、本地服务能力评分",
      "recommended_response_points": [
        "7×24响应",
        "本地驻场",
        "原厂支撑",
        "备品备件"
      ]
    }
  ]
}
```

### 8.3 微调不是第一阶段重点

只有满足以下条件后才建议考虑：

- 至少 100 组以上高质量训练样本
- 已有稳定 prompt
- 已有评测集
- 已明确基线效果
- 已确认瓶颈是风格一致性，而不是知识缺失

## 9. 实施路线图

### 第一阶段：资料标准化（2~4 周）

目标：

- 把现有文件整理成可用资产

工作内容：

- 收集近 3 年投标项目资料
- 文件重命名
- 分类存储
- 拆分历史标书章节
- 提取企业通用资质
- 建案例库
- 建参数库
- 建模板库

验收标准：

- 至少整理 50~100 个项目
- 至少拆出 300 个可复用章节
- 至少沉淀 100 条规则素材

### 第二阶段：规则库建设（2~3 周）

目标：

- 把人工经验转为机器规则

工作内容：

- 归纳废标项
- 归纳资格项
- 归纳评分项类型
- 建一致性规则
- 建附件缺失规则
- 建参数偏离规则

验收标准：

- 常见项目 80% 规则可覆盖
- 常见漏项能被系统识别

### 第三阶段：核心原型开发（4~6 周）

目标：

- 做出第一版可用系统

页面建议：

- 项目导入页
- 招标文件解析页
- 条款清单页
- 评分项页
- 资料匹配页
- 章节生成页
- 风险检查页
- Word 导出页

### 第四阶段：评测体系建设（1~2 周）

评测维度建议：

- 条款识别准确率
- 评分项覆盖率
- 材料匹配准确率
- 章节复用命中率
- 风险识别召回率
- 导出完整性

KPI 建议：

- 资格项识别准确率 >= 95%
- 评分项识别准确率 >= 90%
- 核心章节自动生成覆盖率 >= 70%
- 常见风险识别率 >= 85%
- 单项目初稿生成时间 < 30 分钟

### 第五阶段：微调与优化（后续）

适合微调：

- 公司风格化表述
- 固定章节写法
- 售后方案口吻
- 行业化应答语言

不适合微调：

- 实时资料检索
- 参数真实值匹配
- 报价计算
- 资质有效期判断

## 10. 最小可行版本（MVP）

建议 MVP 只包含：

- 上传招标文件
- 自动提取项目基本信息
- 自动识别资格项、评分项、技术项
- 自动匹配企业资质和案例
- 自动生成 5 个章节：公司简介、技术方案、实施方案、售后服务方案、培训方案
- 自动生成商务/技术响应表初稿
- 输出风险检查清单
- 导出 Word 初稿

建议周期：

- 8~12 周

## 11. 风险提示

最容易失败的 4 个地方：

- 一开始就试图“一键整份生成”
- 没有结构化资料
- 没有规则库
- 没有评测体系

## 12. 结论

正确路径应为：

历史投标文件整理 -> 结构化拆分 -> 知识库建设 -> 规则库建设 -> AI 分步骤生成 -> 自动校验 -> 模板导出 -> 后期微调

不是“把历史标书直接丢给模型”，而是先把标书沉淀成：

- 可检索的知识
- 可执行的规则
- 可复用的模板
- 可评测的任务

这份设计应作为当前系统的上层数据治理方案，与现有在线生成链路并行建设。
