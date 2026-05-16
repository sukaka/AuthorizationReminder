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

  test('saves category hierarchy with parent and level', async () => {
    const mockDb = {
      get: vi.fn()
        .mockResolvedValueOnce({ id: 2, name: '技术部' })
        .mockResolvedValueOnce({ id: 10, department_id: 2, name: '故障排查', level: 2 })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 11, department_id: 2, parent_id: 10, level: 3, name: '网络故障' }),
      run: vi.fn().mockResolvedValue({ insertId: 11 }),
    };

    await expect(service.saveCategory(
      mockDb,
      { department_id: 2, parent_id: 10, name: '网络故障' },
      { id: 1, display_name: '管理员' },
      '127.0.0.1'
    )).resolves.toMatchObject({ id: 11, parent_id: 10, level: 3, name: '网络故障' });
    expect(mockDb.run).toHaveBeenCalledWith(
      expect.stringContaining('parent_id'),
      expect.arrayContaining([2, 10, 3, '网络故障'])
    );
  });

  test('rejects category hierarchy deeper than three levels', async () => {
    const mockDb = {
      get: vi.fn()
        .mockResolvedValueOnce({ id: 2, name: '技术部' })
        .mockResolvedValueOnce({ id: 10, department_id: 2, name: '四级父类', level: 3 }),
      run: vi.fn(),
    };

    await expect(service.saveCategory(
      mockDb,
      { department_id: 2, parent_id: 10, name: '不能保存' },
      { id: 1 },
      '127.0.0.1'
    )).rejects.toMatchObject({ message: '提示词分类最多支持三级', statusCode: 400 });
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
        .mockResolvedValueOnce({ id: 3, department_id: 2, name: '技术方案' })
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
    expect(mockDb.run).toHaveBeenCalledWith(
      expect.stringContaining('pc_audit_logs'),
      expect.arrayContaining([
        'prompt.create',
        'prompt',
        8,
        expect.stringContaining('"department_name":"技术部"'),
        '127.0.0.1',
      ])
    );
    expect(mockDb.run.mock.calls[0][1][6]).toContain('"category_name":"技术方案"');
    expect(mockDb.run.mock.calls[0][1][6]).toContain('"version_no":1');
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

  test('listPrompts includes prompts under descendant categories', async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue([]),
    };

    await service.listPrompts(mockDb, { category_id: 10 }, { user: { id: 18, role: 'admin' } });

    expect(mockDb.query.mock.calls[0][0]).toMatch(/WITH RECURSIVE category_tree/i);
    expect(mockDb.query.mock.calls[0][1]).toEqual(expect.arrayContaining([10]));
  });

  test('listPrompts binds category tree params before department filters', async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue([]),
    };

    await service.listPrompts(
      mockDb,
      { department_id: 2, category_id: 10 },
      { user: { id: 18, role: 'admin' } }
    );

    expect(mockDb.query.mock.calls[0][1].slice(0, 2)).toEqual([10, 2]);
  });

  test('listCategories counts prompts under descendant categories', async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue([]),
    };

    await service.listCategories(mockDb, { department_id: 2 });

    expect(mockDb.query.mock.calls[0][0]).toMatch(/WITH RECURSIVE category_tree/i);
    expect(mockDb.query.mock.calls[0][0]).toMatch(/ct\.root_id = c\.id/);
    expect(mockDb.query.mock.calls[0][0]).toMatch(/AS direct_prompt_count/);
  });

  test('favorites are personal to the current user', async () => {
    const mockDb = {
      run: vi.fn().mockResolvedValue({ affectedRows: 1 }),
      query: vi.fn().mockResolvedValue([
        {
          id: 8,
          department_id: 2,
          category_id: 11,
          title: '网络故障排查',
          content: '请分析 {{故障}}',
          tags_json: '[]',
          is_favorite: 1,
        },
      ]),
    };

    await service.addFavorite(mockDb, 8, { id: 18, display_name: '张磊' }, '10.0.0.8');
    const favorites = await service.listFavoritePrompts(mockDb, { user: { id: 18, role: 'user' } });

    expect(mockDb.run).toHaveBeenCalledWith(
      expect.stringContaining('pc_prompt_favorites'),
      expect.arrayContaining([18, 8])
    );
    expect(mockDb.query.mock.calls[0][1]).toContain(18);
    expect(favorites[0]).toMatchObject({ id: 8, is_favorite: true });
  });

  test('writes detailed prompt audit records with actor and request ip', async () => {
    const mockDb = {
      run: vi.fn().mockResolvedValue({ insertId: 1 }),
    };

    await service.logAudit(mockDb, {
      user: { id: 7, display_name: '张磊', role: 'auditor' },
      action: 'prompt.update',
      entity: 'prompt',
      entityId: 8,
      detail: {
        title: '技术排障提示词',
        department_name: '技术部',
        category_name: '技术方案',
        before: { title: '旧标题' },
        after: { title: '新标题' },
      },
      requestIp: '10.0.0.8',
    });

    expect(mockDb.run).toHaveBeenCalledWith(
      expect.stringContaining('pc_audit_logs'),
      [
        7,
        '张磊',
        'auditor',
        'prompt.update',
        'prompt',
        8,
        JSON.stringify({
          title: '技术排障提示词',
          department_name: '技术部',
          category_name: '技术方案',
          before: { title: '旧标题' },
          after: { title: '新标题' },
        }),
        '10.0.0.8',
      ]
    );
  });
});
