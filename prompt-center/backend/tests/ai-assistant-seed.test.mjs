import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, test, vi } from 'vitest';

const require = createRequire(import.meta.url);
const seed = require('../scripts/seed-ai-assistant-prompts');
const service = require('../src/prompt-service');

const catalogPath = path.resolve(
  process.cwd(),
  '../../juxin-ai-assistant/server/catalog/assistants.json'
);


describe('AI assistant prompt seed', () => {
  test('builds one published prompt per catalog task with matching ids and variables', () => {
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    const prompts = seed.buildPromptDefinitions(catalog);
    const tasks = catalog.assistants.flatMap((item) => item.tasks);

    expect(prompts).toHaveLength(tasks.length);
    expect(new Set(prompts.map((item) => item.id)).size).toBe(tasks.length);
    expect(prompts.map((item) => item.id)).toEqual(
      expect.arrayContaining([1001, 1258])
    );
    for (const prompt of prompts) {
      expect(prompt.status).toBe('published');
      for (const variable of prompt.variables) {
        expect(prompt.content).toContain(`{{${variable}}}`);
      }
    }
  });

  test('uses reviewed prompt content and supports dynamic task counts', () => {
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    const prompts = seed.buildPromptDefinitions(catalog);
    const tasks = catalog.assistants.flatMap((item) => item.tasks);

    expect(prompts).toHaveLength(tasks.length);
    expect(prompts.find((item) => item.id === 1002).content)
      .toBe(tasks
        .find((item) => item.prompt_external_id === 1002)
        .prompt_content);
  });

  test('rejects empty reviewed prompt content before opening a transaction', async () => {
    const catalog = {
      assistants: [{
        code: 'general',
        name: '通用助手',
        tasks: [{
          prompt_external_id: 1002,
          name: '会议纪要',
          description: '整理会议',
          prompt_content: '   ',
        }],
      }],
    };
    const database = {
      get: vi.fn(),
      transaction: vi.fn(),
    };

    await expect(seed.seedAiAssistantPrompts(database, catalog)).rejects.toThrow(
      'AI 助手 Prompt 内容不能为空'
    );
    expect(database.get).not.toHaveBeenCalled();
    expect(database.transaction).not.toHaveBeenCalled();
  });

  test('upserts deterministic ids and does not create a new version when unchanged', async () => {
    const prompt = {
      id: 1002,
      assistantCode: 'general',
      title: '会议纪要',
      summary: '整理会议',
      content: '任务：会议纪要\n{{background}}',
      tags: ['聚信 AI 助手', '通用助手'],
      status: 'published',
      variables: ['background'],
    };
    const tx = {
      get: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 1002, current_version_id: 9002 })
        .mockResolvedValueOnce({
          id: 9002,
          title: prompt.title,
          summary: prompt.summary,
          content: prompt.content,
          tags_json: JSON.stringify(prompt.tags),
        }),
      run: vi.fn()
        .mockResolvedValueOnce({ insertId: 1002 })
        .mockResolvedValueOnce({ insertId: 9002 }),
    };

    const first = await seed.upsertPrompt(tx, prompt, 10, 20);
    const second = await seed.upsertPrompt(tx, prompt, 10, 20);

    expect(first).toEqual({ created: 1, versionsCreated: 1, updated: 0 });
    expect(second).toEqual({ created: 0, versionsCreated: 0, updated: 0 });
    expect(tx.run).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO pc_prompts'),
      expect.arrayContaining([1002, 10, 20, '会议纪要'])
    );
  });

  test('keeps prompt id while force publishing a changed version', async () => {
    const prompt = {
      id: 1002,
      assistantCode: 'general',
      title: '会议纪要',
      summary: '整理会议',
      content: '新版会议纪要\n{{background}}',
      tags: ['聚信 AI 助手', '通用助手'],
      status: 'published',
      variables: ['background'],
    };
    const tx = {
      get: vi.fn()
        .mockResolvedValueOnce({ id: 1002, current_version_id: 9002 })
        .mockResolvedValueOnce({
          id: 9002,
          title: prompt.title,
          summary: prompt.summary,
          content: '旧版会议纪要\n{{background}}',
          tags_json: JSON.stringify(prompt.tags),
        })
        .mockResolvedValueOnce({ version_no: 1 }),
      run: vi.fn()
        .mockResolvedValueOnce({ insertId: 9003 })
        .mockResolvedValueOnce({ affectedRows: 1 }),
    };

    await expect(seed.upsertPrompt(tx, prompt, 10, 20, { force: true }))
      .resolves.toEqual({ created: 0, versionsCreated: 1, updated: 1 });

    expect(tx.run).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO pc_prompt_versions'),
      expect.arrayContaining([1002, 2, '会议纪要'])
    );
    expect(tx.run).toHaveBeenCalledWith(
      expect.stringContaining('current_version_id = ?'),
      expect.arrayContaining([9003, 'AI 助手目录种子', 1002])
    );
  });

  test('stages changed versions without changing runtime until activation', async () => {
    const catalog = {
      assistants: [{
        code: 'general',
        name: '通用助手',
        tasks: [{
          prompt_external_id: 1002,
          name: '会议纪要',
          description: '整理会议',
          source_version: 'V1.10',
          prompt_content: '新版会议纪要\n{{background}}',
        }],
      }],
    };
    const database = createPromptSeedDatabase();

    const before = await service.getPublishedPrompt(database, 1002);
    const stage = await seed.stageAiAssistantPrompts(database, catalog, {
      force: true,
    });
    const afterStage = await service.getPublishedPrompt(database, 1002);
    const secondStage = await seed.stageAiAssistantPrompts(database, catalog, {
      force: true,
    });
    const stagedVersion = database.versions.find(
      (item) => item.prompt_id === 1002 && item.version_no === 2
    );
    stagedVersion.tags_json = JSON.parse(stagedVersion.tags_json);
    await seed.activateStagedPrompts(database, catalog, stage.stagedVersions);
    const afterActivation = await service.getPublishedPrompt(database, 1002);

    expect(before.content).toBe('旧版会议纪要\n{{background}}');
    expect(stage.stagedVersions).toEqual({ 1002: 2 });
    expect(afterStage.content).toBe('旧版会议纪要\n{{background}}');
    expect(secondStage.stagedVersions).toEqual({ 1002: 2 });
    expect(database.versions.filter((item) => item.prompt_id === 1002)).toHaveLength(2);
    expect(afterActivation).toMatchObject({
      prompt_id: 1002,
      version_no: 2,
      content: '新版会议纪要\n{{background}}',
    });
  });

  test('refuses partial activation when a staged version is missing', async () => {
    const catalog = {
      assistants: [{
        code: 'general',
        name: '通用助手',
        tasks: [{
          prompt_external_id: 1002,
          name: '会议纪要',
          description: '整理会议',
          source_version: 'V1.10',
          prompt_content: '新版会议纪要\n{{background}}',
        }],
      }],
    };
    const database = createPromptSeedDatabase();
    const originalCurrentVersionId = database.prompts.get(1002).current_version_id;

    await expect(seed.activateStagedPrompts(database, catalog, { 1002: 2 }))
      .rejects.toThrow('AI 助手 Prompt staged version 不存在');

    expect(database.prompts.get(1002).current_version_id).toBe(originalCurrentVersionId);
  });

  test('refuses incomplete or stale staged activation sets', async () => {
    const catalog = {
      assistants: [{
        code: 'general',
        name: '通用助手',
        tasks: [
          {
            prompt_external_id: 1002,
            name: '会议纪要',
            description: '整理会议',
            source_version: 'V1.10',
            prompt_content: '新版会议纪要\n{{background}}',
          },
          {
            prompt_external_id: 1003,
            name: '工作计划',
            description: '制定计划',
            source_version: 'V1.10',
            prompt_content: '新版工作计划\n{{plan}}',
          },
        ],
      }],
    };
    const incompleteDatabase = createPromptSeedDatabase();
    const staleDatabase = createPromptSeedDatabase();
    const originalCurrentVersionId = staleDatabase.prompts.get(1002).current_version_id;

    await expect(seed.activateStagedPrompts(incompleteDatabase, catalog, { 1002: 2 }))
      .rejects.toThrow('AI 助手 Prompt staged version 不完整');

    await expect(seed.activateStagedPrompts(staleDatabase, {
      assistants: [{
        code: 'general',
        name: '通用助手',
        tasks: [{
          prompt_external_id: 1002,
          name: '会议纪要',
          description: '整理会议',
          source_version: 'V1.10',
          prompt_content: '新版会议纪要\n{{background}}',
        }],
      }],
    }, { 1002: 1 }))
      .rejects.toThrow('AI 助手 Prompt staged version 与当前目录不一致');

    expect(staleDatabase.prompts.get(1002).current_version_id).toBe(originalCurrentVersionId);
  });

  test('publishes a staged new prompt with a current version on normal seed', async () => {
    const catalog = {
      assistants: [{
        code: 'general',
        name: '通用助手',
        tasks: [{
          prompt_external_id: 1003,
          name: '工作计划',
          description: '制定计划',
          source_version: 'V1.10',
          prompt_content: '新版工作计划\n{{plan}}',
        }],
      }],
    };
    const database = createPromptSeedDatabase();

    await seed.stageAiAssistantPrompts(database, catalog, { force: true });
    await expect(service.getPublishedPrompt(database, 1003))
      .rejects.toThrow('已发布提示词不存在');

    await seed.seedAiAssistantPrompts(database, catalog);
    const published = await service.getPublishedPrompt(database, 1003);

    expect(published).toMatchObject({
      prompt_id: 1003,
      version_no: 1,
      content: '新版工作计划\n{{plan}}',
    });
    expect(database.prompts.get(1003).current_version_id).toBeTruthy();
  });

  test('rejects unsafe CLI argument combinations before default publishing', () => {
    expect(() => seed.parseCliOptions(['--stage-output']))
      .toThrow('--stage-output 需要提供路径');
    expect(() => seed.parseCliOptions(['--activate', '--force']))
      .toThrow('--activate 需要提供路径');
    expect(() => seed.parseCliOptions([
      '--stage-output',
      '/tmp/stage.json',
      '--activate',
      '/tmp/stage.json',
    ])).toThrow('--stage-output 与 --activate 不能同时使用');
  });
});


const createPromptSeedDatabase = () => {
  let nextVersionId = 9003;
  const state = {
    departments: new Map([['聚信 AI 助手', { id: 10, name: '聚信 AI 助手' }]]),
    categories: new Map([['10:通用助手', { id: 20, name: '通用助手' }]]),
    prompts: new Map([[
      1002,
      {
        id: 1002,
        department_id: 10,
        category_id: 20,
        title: '会议纪要',
        summary: '整理会议',
        content: '旧版会议纪要\n{{background}}',
        tags_json: JSON.stringify(['聚信 AI 助手', '通用助手']),
        status: 'published',
        visibility: 'company',
        current_version_id: 9002,
      },
    ]]),
    versions: [{
      id: 9002,
      prompt_id: 1002,
      version_no: 1,
      title: '会议纪要',
      summary: '整理会议',
      content: '旧版会议纪要\n{{background}}',
      tags_json: JSON.stringify(['聚信 AI 助手', '通用助手']),
    }],
  };

  const get = async (sql, params = []) => {
    if (sql.includes('FROM pc_departments WHERE name = ?')) {
      return state.departments.get(params[0]) || null;
    }
    if (sql.includes('FROM pc_categories WHERE department_id = ? AND name = ?')) {
      return state.categories.get(`${params[0]}:${params[1]}`) || null;
    }
    if (sql.includes('SELECT id, current_version_id FROM pc_prompts WHERE id = ?')) {
      const prompt = state.prompts.get(Number(params[0]));
      return prompt ? { id: prompt.id, current_version_id: prompt.current_version_id } : null;
    }
    if (sql.includes('FROM pc_prompt_versions') && sql.includes('WHERE id = ? AND prompt_id = ?')) {
      return state.versions.find((item) =>
        item.id === Number(params[0]) && item.prompt_id === Number(params[1])
      ) || null;
    }
    if (sql.includes('FROM pc_prompt_versions') && sql.includes('WHERE prompt_id = ? AND version_no = ?')) {
      return state.versions.find((item) =>
        item.prompt_id === Number(params[0]) && item.version_no === Number(params[1])
      ) || null;
    }
    if (sql.includes('FROM pc_prompt_versions') && sql.includes('ORDER BY version_no DESC')) {
      return state.versions
        .filter((item) => item.prompt_id === Number(params[0]))
        .sort((a, b) => b.version_no - a.version_no)[0] || null;
    }
    if (sql.includes('COALESCE(MAX(version_no), 0)')) {
      const promptVersions = state.versions.filter((item) => item.prompt_id === Number(params[0]));
      return {
        version_no: Math.max(0, ...promptVersions.map((item) => item.version_no)),
      };
    }
    if (sql.includes('INNER JOIN pc_prompt_versions v ON v.prompt_id = p.id')) {
      const prompt = state.prompts.get(Number(params[0]));
      if (!prompt || prompt.status !== 'published') return null;
      const version = state.versions.find((item) =>
        item.prompt_id === prompt.id && item.id === prompt.current_version_id
      );
      if (!version) return null;
      return {
        prompt_id: prompt.id,
        status: prompt.status,
        version_id: version.id,
        version_no: version.version_no,
        title: version.title,
        summary: version.summary,
        content: version.content,
        tags_json: version.tags_json,
      };
    }
    throw new Error(`Unhandled get SQL: ${sql}`);
  };

  const run = async (sql, params = []) => {
    if (sql.includes('INSERT INTO pc_prompts')) {
      const [
        promptId,
        departmentId,
        categoryId,
        title,
        summary,
        content,
        tagsJson,
      ] = params;
      state.prompts.set(Number(promptId), {
        id: Number(promptId),
        department_id: Number(departmentId),
        category_id: Number(categoryId),
        title,
        summary,
        content,
        tags_json: tagsJson,
        status: sql.includes("'draft'") ? 'draft' : 'published',
        visibility: 'company',
        current_version_id: null,
      });
      return { insertId: Number(promptId) };
    }
    if (sql.includes('INSERT INTO pc_prompt_versions')) {
      const [promptId, versionNo, title, summary, content, tagsJson] = params;
      const id = nextVersionId;
      nextVersionId += 1;
      state.versions.push({
        id,
        prompt_id: Number(promptId),
        version_no: Number(versionNo),
        title,
        summary,
        content,
        tags_json: tagsJson,
      });
      return { insertId: id };
    }
    if (
      sql.includes('UPDATE pc_prompts SET current_version_id = ? WHERE id = ?')
    ) {
      const [versionId, promptId] = params.map(Number);
      state.prompts.get(promptId).current_version_id = versionId;
      return { affectedRows: 1 };
    }
    if (sql.includes('UPDATE pc_prompts') && sql.includes('current_version_id = ?')) {
      const versionId = Number(params[6]);
      const promptId = Number(params[8]);
      const prompt = state.prompts.get(promptId);
      const version = state.versions.find((item) => item.id === versionId);
      Object.assign(prompt, {
        department_id: Number(params[0]),
        category_id: Number(params[1]),
        title: version.title,
        summary: version.summary,
        content: version.content,
        tags_json: version.tags_json,
        status: 'published',
        visibility: 'company',
        current_version_id: versionId,
      });
      return { affectedRows: 1 };
    }
    if (sql.includes('UPDATE pc_prompts') && sql.includes("SET status = 'published'")) {
      const prompt = state.prompts.get(Number(params[0]));
      prompt.status = 'published';
      return { affectedRows: 1 };
    }
    throw new Error(`Unhandled run SQL: ${sql}`);
  };

  return {
    ...state,
    get,
    run,
    transaction: async (fn) => fn({ get, run }),
  };
};
