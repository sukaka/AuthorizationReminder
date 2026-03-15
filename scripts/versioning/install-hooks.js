#!/usr/bin/env node
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..', '..');

try {
  execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], {
    cwd: rootDir,
    stdio: 'inherit',
  });
  console.log('[versioning] 已将 git hooks 路径设置为 .githooks');
} catch (error) {
  console.error(`[versioning] 安装 hooks 失败：${error.message}`);
  process.exit(1);
}
