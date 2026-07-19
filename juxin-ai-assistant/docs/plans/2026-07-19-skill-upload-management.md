# Skill 前台上传与分级管理计划

## 目标

为 Skill 增加可持久化的前台上传能力，并明确两类可见性：

- 用户 Skill：普通用户上传，只对上传者可见和可运行。
- 系统通用 Skill：仅平台管理员上传，审核/发布后对所有用户可见。

## 目标文件

- `server/app/config.py`：增加 Skill 包持久化目录配置。
- `server/app/models.py`：增加上传 Skill 元数据模型。
- `server/app/skill_registry.py`：抽取单个 Skill 包加载逻辑，复用内置包和上传包。
- `server/app/skill_uploads.py`：ZIP 校验、解压、存储与上传记录转换。
- `server/app/skill_routes.py`：增加用户/管理员上传、列表、个人停用接口，并持久化管理操作。
- `server/alembic/versions/0066_skill_uploads.py`：新增上传 Skill 表。
- `server/tests/test_skill_uploads.py`：覆盖包校验、个人隔离、管理员通用上传、越权拒绝和发布后可见性。
- `apps/desktop/src/api/client.ts`：增加用户 Skill 上传/列表/停用 API。
- `apps/desktop/src/api/governance.ts`：增加管理员通用 Skill 上传 API。
- `apps/desktop/src/pages/SkillsPage.tsx`：增加“我的 Skill”上传和“系统通用 Skill”分区。
- `apps/desktop/src/pages/admin/SkillsAdminPage.tsx`：增加管理员通用 Skill 上传入口。

## 约束与验收

- 上传格式为包含 `skill.json`、`SKILL.md`、提示词、Schema、示例和检查清单的 ZIP 包。
- 拒绝路径穿越、符号链接、超大压缩包和缺失必需文件。
- 普通用户无法通过参数或接口将个人包变成系统通用包。
- 个人包上传后立即可用；通用包先进入待审核，管理员发布后才对普通用户可见。
- Skill 包路径不直接暴露为静态文件；运行前按数据库状态和用户归属再次校验。
- 完成后运行 Skill 相关后端测试、TypeScript 类型检查（若依赖可用）和 `git diff --check`。
