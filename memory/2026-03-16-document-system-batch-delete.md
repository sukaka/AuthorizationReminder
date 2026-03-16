# 2026-03-16 文档管理系统分类批量删除修复

## 背景
- 用户反馈：分类页勾选多个分类后点击“批量删除”，实际表现为每次只能删掉一个，需要重复点击。
- 典型场景：父分类和子分类同时被选中，但后端仍按原选中顺序串行套用单删规则。

## 根因
- 分类批量删除接口 `/api/faq/categories/batch-delete` 没有先做依赖排序。
- 当父分类先于已选子分类执行时，会因为“该分类下有子分类”被拦截。
- 同一批次里子分类删完后，父分类只能等下一次再删，形成“看起来像一条一条删”的体验。

## 修复
- 在 `faq/backend/src/category-delete.js` 新增 `orderCategoryBatchDeleteIds`：
  - 只针对当前选中的分类计算深度
  - 让已选子分类优先于已选父分类删除
  - 同层级维持原始选择顺序
- 在 `faq/backend/src/index.js` 的批量删除路由中接入该排序结果，再逐条执行既有删除守卫和删除逻辑。

## 测试
- 新增 helper 单测：父子分类同选时，删除顺序应为“子先父后”。
- 新增 smoke 用例：父分类和子分类一起选中时，批量删除应一次删完。
- 本地验证：
  - `npm --prefix /Users/zhanglei/Documents/codex-new/faq/backend test -- tests/category-delete.test.js` 通过
  - 真实 smoke 因当前环境无法自动解析可复用管理员凭证，未能完成非跳过验证；后端健康检查正常，容器已重建。
