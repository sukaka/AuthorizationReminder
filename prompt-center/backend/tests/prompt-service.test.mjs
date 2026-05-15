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

  test('saves department manager fields', async () => {
    const mockDb = {
      get: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 5, name: '技术部', manager_user_id: 18, manager_name: '张磊' }),
      run: vi.fn().mockResolvedValue({ insertId: 5 }),
    };

    await expect(service.saveDepartment(
      mockDb,
      { name: '技术部', manager_user_id: '18', manager_name: '张磊' },
      { id: 1 },
      '127.0.0.1'
    )).resolves.toMatchObject({ manager_user_id: 18, manager_name: '张磊' });
    expect(mockDb.run).toHaveBeenCalledWith(
      expect.stringContaining('manager_user_id'),
      expect.arrayContaining([18, '张磊'])
    );
  });

  test('rejects prompt creation by a non department manager', async () => {
    const mockDb = {
      get: vi.fn().mockResolvedValueOnce({ id: 2, name: '技术部', manager_user_id: 18, manager_name: '张磊' }),
      run: vi.fn(),
    };

    await expect(service.createPrompt(
      mockDb,
      { title: '排障提示词', content: '请分析 {{故障}}', department_id: 2, category_id: 3 },
      { id: 19, display_name: '李雷' },
      '127.0.0.1'
    )).rejects.toMatchObject({ message: '仅技术部负责人可维护该部门提示词', statusCode: 403 });
  });

  test('allows prompt creation by the department manager', async () => {
    const mockDb = {
      get: vi.fn()
        .mockResolvedValueOnce({ id: 2, name: '技术部', manager_user_id: 18, manager_name: '张磊' })
        .mockResolvedValueOnce({ id: 3, department_id: 2 })
        .mockResolvedValueOnce({
          id: 8,
          department_id: 2,
          category_id: 3,
          title: '排障提示词',
          content: '请分析 {{故障}}',
          tags_json: '[]',
        }),
      transaction: vi.fn(async (fn) => fn({
        get: vi.fn().mockResolvedValue({ latest: 0 }),
        run: vi.fn()
          .mockResolvedValueOnce({ insertId: 8 })
          .mockResolvedValueOnce({ insertId: 11 })
          .mockResolvedValueOnce({ affectedRows: 1 }),
      })),
      run: vi.fn(),
    };

    await expect(service.createPrompt(
      mockDb,
      { title: '排障提示词', content: '请分析 {{故障}}', department_id: 2, category_id: 3 },
      { id: 18, display_name: '张磊' },
      '127.0.0.1'
    )).resolves.toMatchObject({ id: 8, department_id: 2, category_id: 3 });
    expect(mockDb.transaction).toHaveBeenCalledOnce();
  });

  test('rejects prompt update by a non department manager', async () => {
    const mockDb = {
      get: vi.fn()
        .mockResolvedValueOnce({
          id: 8,
          department_id: 2,
          category_id: 3,
          title: '排障提示词',
          content: '旧内容',
          visibility: 'department',
          status: 'draft',
          tags_json: '[]',
        })
        .mockResolvedValueOnce({ id: 2, name: '技术部', manager_user_id: 18, manager_name: '张磊' }),
      transaction: vi.fn(),
    };

    await expect(service.updatePrompt(
      mockDb,
      8,
      { content: '新内容' },
      { id: 19, display_name: '李雷' },
      '127.0.0.1'
    )).rejects.toMatchObject({ message: '仅技术部负责人可维护该部门提示词', statusCode: 403 });
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  test('rejects prompt rollback by a non department manager', async () => {
    const mockDb = {
      get: vi.fn()
        .mockResolvedValueOnce({
          id: 8,
          department_id: 2,
          category_id: 3,
          title: '排障提示词',
          content: '旧内容',
          visibility: 'department',
          status: 'draft',
          tags_json: '[]',
        })
        .mockResolvedValueOnce({ id: 2, name: '技术部', manager_user_id: 18, manager_name: '张磊' }),
      run: vi.fn(),
    };

    await expect(service.rollbackPrompt(
      mockDb,
      8,
      11,
      { id: 19, display_name: '李雷' },
      '127.0.0.1'
    )).rejects.toMatchObject({ message: '仅技术部负责人可维护该部门提示词', statusCode: 403 });
    expect(mockDb.run).not.toHaveBeenCalled();
  });
});
