# 2026-07-19 Skill 上传与分级管理

## 背景

用户要求 Skill 在前台可上传，并区分用户自己的 Skill 与系统通用 Skill。个人 Skill 由普通用户上传且只对自己可见；系统通用 Skill 只能由管理员上传，审核发布后全员可见。

## 已确认现状

- 内置 Skill 位于 `agent-harness/skills`，`SkillRegistry` 只扫描文件目录。
- `/api/skills` 与 `/api/admin/skills` 目前只读文件目录。
- 管理员发布/停用仅返回内存中的 Manifest 副本，没有持久化。
- 前端 `SkillsPage` 和 `SkillsAdminPage` 都没有上传控件。

## 本次实现决策

- 上传包使用 ZIP，并复用现有 Skill 必需文件契约。
- 使用 `UploadedSkill` 表保存包归属、可见性、状态、版本和存储 key。
- 个人上传接口固定 `scope=personal`；管理员通用上传接口固定 `scope=company`。
- 个人上传后状态为 `published`；通用上传后状态为 `pending_review`，管理员审核/发布后才进入系统列表。
- 包存储在配置的 Skill 存储目录下，运行时按用户身份与数据库状态过滤。
