import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPromptPayload, extractVariables, normalizeTags, tagsToInput } from '../src/prompt-utils.js';

test('normalizeTags supports Chinese separators and removes duplicates', () => {
  assert.deepEqual(normalizeTags('销售，#拜访、销售,总结'), ['销售', '拜访', '总结']);
});

test('extractVariables returns unique variables in order', () => {
  assert.deepEqual(extractVariables('写一份 {{客户名称}} 的 {{拜访目标}}，客户为 {{客户名称}}'), [
    '客户名称',
    '拜访目标',
  ]);
});

test('buildPromptPayload converts ids and tags', () => {
  assert.deepEqual(buildPromptPayload({
    title: ' 客户总结 ',
    summary: ' 复盘 ',
    content: '内容',
    department_id: '1',
    category_id: '2',
    tags: tagsToInput(['销售', '总结']),
  }), {
    title: '客户总结',
    summary: '复盘',
    content: '内容',
    department_id: 1,
    category_id: 2,
    visibility: 'department',
    tags: ['销售', '总结'],
    change_note: '',
  });
});
