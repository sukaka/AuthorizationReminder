# 培训考试系统重复题目修复记忆

日期：2026-07-21

## 背景

同一考试会话内出现重复 `question_id` 时，前端的 radio 分组、React key 和答案状态会互相覆盖，后端按 `session_id + question_id LIMIT 1` 保存答案也无法正确区分记录。已知异常会话为 #239，重复题目为 `question_id=554`。

## 目标

- 随机出卷在单次会话内维护已选题目集合，规则候选池重叠时排除已选题并继续补抽。
- 固定试卷在前后端拒绝同一 `paper_id` 内的重复题目。
- 创建会话前对 snapshots 去重，不能静默创建重复题会话。
- 清理历史 `te_exam_answers` 重复记录后增加 `UNIQUE(session_id, question_id)`，不改历史成绩和审计记录。
- 核查并按审计/备份流程修复会话 #239（仅当状态仍为 started 时处理）。

## 已确认实现位置

- 后端出卷和会话创建：`backend/src/index.js`
- 数据库建表和初始化：`backend/src/db.js`
- 答题页和固定题目输入：`frontend/src/App.jsx`
- 后端测试：`backend/tests/`

## 操作约束

- 保留工作区中与本任务无关的已有修改。
- 不做全局题目去重；去重范围只限同一 paper 或同一 exam session。
- 未经明确要求不提交、推送或升级版本号。
- 不在代码、日志或回复中暴露密码、令牌等敏感信息。
