import { createRequire } from 'node:module';
import { describe, expect, test, vi } from 'vitest';

const require = createRequire(import.meta.url);
const db = require('../src/db');
const service = require('../src/prompt-service');

describe('prompt center service helpers', () => {
  test('exports schema bootstrap helpers', () => {
    expect(typeof db.createSchema).toBe('function');
    expect(typeof db.initDb).toBe('function');
    expect(typeof db.query).toBe('function');
  });

  test('normalizes tags from Chinese and English separators', () => {
    expect(service.normalizeTags('话术, 客户总结，#话术、  ')).toEqual(['话术', '客户总结']);
  });

  test('extracts variables from prompt content', () => {
    expect(service.extractPromptVariables('请根据 {{客户名称}} 生成 {{拜访目标}}，再补充 {{客户名称}}。')).toEqual([
      '客户名称',
      '拜访目标',
    ]);
  });

  test('validates prompt payload shape', () => {
    expect(() => service.normalizePromptPayload({ title: '', content: 'x' })).toThrow('标题');
    expect(service.normalizePromptPayload({
      title: '客户拜访总结',
      content: '总结 {{客户名称}} 的本次拜访',
      department_id: 1,
      category_id: 2,
      tags: ['销售', '拜访'],
    })).toMatchObject({
      title: '客户拜访总结',
      department_id: 1,
      category_id: 2,
      visibility: 'department',
      tags: ['销售', '拜访'],
    });
  });

  test('returns a business error when department name already exists', async () => {
    const mockDb = {
      get: vi.fn().mockResolvedValue({ id: 2 }),
      run: vi.fn(),
    };

    await expect(service.saveDepartment(mockDb, { name: '技术部' }, { id: 1 }, '127.0.0.1'))
      .rejects.toMatchObject({ message: '部门“技术部”已存在', statusCode: 409 });
    expect(mockDb.run).not.toHaveBeenCalled();
  });

  test('returns a business error when category name already exists in department', async () => {
    const mockDb = {
      get: vi.fn()
        .mockResolvedValueOnce({ id: 2, name: '技术部' })
        .mockResolvedValueOnce({ id: 3 }),
      run: vi.fn(),
    };

    await expect(service.saveCategory(mockDb, { department_id: 2, name: '技术方案' }, { id: 1 }, '127.0.0.1'))
      .rejects.toMatchObject({ message: '分类“技术方案”在该部门下已存在', statusCode: 409 });
    expect(mockDb.run).not.toHaveBeenCalled();
  });
});
