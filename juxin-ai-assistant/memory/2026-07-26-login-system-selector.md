# 2026-07-26 登录系统选择页

## 完成内容

- 去掉桌面端 bootstrap 默认追加的 `system=ai-assistant`；
- 去掉前端默认登录入口和 401 重登录入口默认追加的 `system=ai-assistant`；
- 保留手动切换系统时的 `system=<key>` 定向跳转；
- 更新前后端测试，验证默认进入统一门户选择页。
- 登录页补充“统一登录后请选择要进入的系统”提示文案。

## 影响说明

- admin 和普通用户统一登录后都会先到系统选择页；
- 用户进入具体系统前，需要先在统一门户里选自己有权限的系统；
- 已登录状态下，AI 助手内的“切换系统”菜单逻辑不变。

## 验证结果

- `python3 -m pytest -q tests/test_desktop_bootstrap.py`（在 `server/` 下）通过，13 passed；
- `npm test -- --reporter=dot tests/session.test.tsx`（在 `apps/desktop/` 下）通过，15 passed。
