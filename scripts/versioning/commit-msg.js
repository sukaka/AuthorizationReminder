#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const {
  normalizeCommitMessage,
  validateCommitMessage,
} = require('./automation');

const commitMessageFile = process.argv[2];

if (!commitMessageFile) {
  console.error('[versioning] commit-msg hook 缺少提交信息文件路径');
  process.exit(1);
}

try {
  const resolvedPath = path.resolve(commitMessageFile);
  const original = fs.readFileSync(resolvedPath, 'utf8');
  const normalized = normalizeCommitMessage(original);
  if (normalized !== original) {
    fs.writeFileSync(resolvedPath, normalized);
  }
  validateCommitMessage(normalized);
} catch (error) {
  console.error(`[versioning] ${error.message}`);
  process.exit(1);
}
