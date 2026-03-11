# Course Learning Modal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将课程学习路径与章节完成度从页面内联区域改为课程列表触发的弹窗视图。

**Architecture:** 继续复用 `App.jsx` 中现有的课程、学习路径、学习进度状态和接口请求。实现层只新增弹窗状态与课程列表按钮，把原有学习路径面板 JSX 搬到弹窗中，并补充少量样式，不引入新的接口或组件拆分。

**Tech Stack:** React 18, Vite 5, CSS

---

### Task 1: 记录入口与弹窗状态

**Files:**
- Modify: `train-exam/frontend/src/App.jsx`

**Step 1: 写打开/关闭课程学习弹窗状态**

新增：
- `isCourseLearningModalOpen`
- `courseLearningPendingId`
- `onOpenCourseLearningModal`
- `closeCourseLearningModal`

**Step 2: 复用现有数据请求**

打开弹窗时调用：
- `fetchLearningPath(courseId, true)`
- `fetchMyLearningProgress(true)`

**Step 3: 验证交互完整性**

确认切换菜单时关闭课程学习弹窗，避免残留遮罩。

### Task 2: 调整课程列表入口

**Files:**
- Modify: `train-exam/frontend/src/App.jsx`

**Step 1: 更新课程列表表头与列数**

为所有角色保留“操作”列：
- 普通用户只显示“查看课程”
- 可写角色显示“删除课程”后追加“查看课程”

**Step 2: 绑定查看课程行为**

点击“查看课程”时：
- 记录当前课程 loading 状态
- 拉取该课程学习路径
- 成功后打开弹窗

### Task 3: 将学习路径面板搬入弹窗

**Files:**
- Modify: `train-exam/frontend/src/App.jsx`
- Modify: `train-exam/frontend/src/App.css`

**Step 1: 删除页面内联学习路径面板**

移除“培训管理”页中原本固定展示的“学习路径与章节完成度” section。

**Step 2: 在页面底部挂载弹窗**

弹窗内容保留：
- 文档学习阈值配置
- 课程维度指标卡
- 章节资源表
- 全部课程进度汇总表

**Step 3: 增加样式**

补充：
- 更宽的课程学习弹窗宽度
- 弹窗内部区块间距
- 小屏下头部与表格可用性

### Task 4: 验证

**Files:**
- Modify: `train-exam/frontend/src/App.jsx`
- Modify: `train-exam/frontend/src/App.css`

**Step 1: 运行构建**

Run: `npm run build`

Expected:
- Vite 构建成功
- 无 JSX / CSS 语法错误

**Step 2: 检查 diff**

Run: `git diff -- train-exam/frontend/src/App.jsx train-exam/frontend/src/App.css train-exam/docs/plans/2026-03-10-course-learning-modal-design.md train-exam/docs/plans/2026-03-10-course-learning-modal-implementation-plan.md`

Expected:
- 改动只包含课程列表入口、学习路径弹窗和样式
