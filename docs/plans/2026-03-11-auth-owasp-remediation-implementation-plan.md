# Auth OWASP Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复 `auth` 审计里确认的认证漏洞，包括会话不可撤销、长密码 `bcrypt` 截断、CSRF 依赖风险和邮件依赖风险。

**Architecture:** 采用小步收敛方案：给 JWT 增加服务端会话状态，新增带版本标记的密码哈希工具并兼容旧哈希，移除 `csurf` 改成双提交 CSRF，最后升级 `nodemailer` 并复跑认证链路。数据库层只新增最少表/列，不改现有用户模型。

**Tech Stack:** Node.js, Express, MySQL, JWT, bcryptjs, node:test

---

## Task 1: 会话状态与 JWT 撤销

- 新增 `auth_user_sessions` 表，按 `session_id` 持久化会话
- JWT 增加 `sid`
- 中间件校验签名后再校验会话状态
- `logout` 撤销当前会话
- `change-password` 撤销用户全部会话并清 Cookie

## Task 2: 密码哈希升级与长密码防护

- 增加独立密码工具模块
- 新哈希格式带前缀，避免再受 72 字节截断影响
- 保留旧 `bcrypt` 哈希兼容
- 旧哈希在 `<=72` 字节密码成功登录后自动升级
- 旧哈希在 `>72` 字节输入时拒绝并提示需要重置

## Task 3: 移除 `csurf`

- 改成自管双提交 CSRF
- `/api/auth/csrf` 继续提供 token
- 写接口统一校验 header + cookie
- 前端登录页继续复用现有获取 CSRF 的流程

## Task 4: 依赖升级

- 升级 `nodemailer`
- 移除 `csurf`
- 生成 `auth/package-lock.json`

## Task 5: 测试与运行态验证

- 为密码工具和会话工具补单元测试
- 复跑现有 `auth/tests/security-bootstrap.test.js`
- 复跑登录 / 登出 / 改密 / 旧 token / 长密码碰撞 / CSRF 的运行态脚本
