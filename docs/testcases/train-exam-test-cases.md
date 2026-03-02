# 培训考试系统功能测试用例（详细版）

## 1. 文档信息
- 文档名称：培训考试系统功能测试用例（详细版）
- 适用系统：`train-exam-api` + `web-train-exam` + `auth`
- 文档版本：v1.0
- 测试类型：功能测试（API 主导）

## 2. 测试目标
- 验证培训、题库、试卷、考试、证书、审计主流程可闭环。
- 验证角色权限边界（admin/editor/reviewer/auditor）。

## 3. 测试范围
- 鉴权与角色权限。
- 课程与资源管理。
- FAQ 自动出题与导题。
- 题目审核、试卷发布。
- 考试答题、交卷评分、成绩查询。
- 证书生成与下载。
- 审计日志与 AI 日志查询。

## 4. 详细测试用例
### 4.1 鉴权与权限（AUTH）
- AUTH-TR-001：未登录访问 `GET /api/train-exam/courses` 返回 401。
- AUTH-TR-002：editor 可创建课程、题目草稿。
- AUTH-TR-003：editor 审核题目返回 403。
- AUTH-TR-004：reviewer 可审核题目并发布试卷。
- AUTH-TR-005：auditor 访问写接口返回 403。

### 4.2 培训管理（COURSE）
- COURSE-001：创建课程成功。
- COURSE-002：删除有资源的课程返回 409。
- COURSE-003：创建外链资源并可读取 redirect_url。
- COURSE-004：上传非法扩展名被拒绝。

### 4.3 出题与导题（QUESTION/IMPORT/GEN）
- GEN-001：创建 FAQ 自动出题任务成功。
- GEN-002：执行任务后生成 draft 题目。
- GEN-003：发布任务后 draft 题目转 published。
- GEN-004：AI 配置缺失时任务状态为 `partial_failed` 或 `failed`，规则题仍可落库。
- IMPORT-001：下载导题模板成功。
- IMPORT-002：导入合法 Excel，成功行>0。
- IMPORT-003：导入含错误行，失败统计与错误明细一致。

### 4.4 试卷与考试（PAPER/EXAM/SCORE）
- PAPER-001：固定试卷创建成功。
- PAPER-002：随机试卷创建成功。
- PAPER-003：空题目固定试卷发布失败。
- EXAM-001：发布试卷后可开始考试。
- EXAM-002：答题保存成功。
- EXAM-003：重复提交不会创建多条最终结果。
- EXAM-004：超过考试时长后会话自动超时交卷。
- SCORE-001：单选/多选/判断/填空评分正确。
- SCORE-002：第4次开始考试被拒绝（max_attempts=3）。
- RESULT-001：最终成绩取最后一次（is_final=1）。

### 4.5 证书与审计（CERT/AUDIT）
- CERT-001：通过成绩可生成证书。
- CERT-002：未通过成绩生成证书返回 409。
- CERT-003：证书下载成功。
- AUDIT-001：关键写操作均有 `te_operation_logs` 记录。
- AUDIT-002：auditor 可查看审计日志和 AI 日志。

## 5. 回归建议
- 修改鉴权逻辑后优先回归 AUTH-TR 全量。
- 修改评分逻辑后优先回归 SCORE/RESULT 全量。
- 修改出题逻辑后优先回归 GEN/IMPORT/PAPER。
