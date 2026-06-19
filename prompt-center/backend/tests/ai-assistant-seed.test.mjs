import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, test, vi } from 'vitest';

const require = createRequire(import.meta.url);
const seed = require('../scripts/seed-ai-assistant-prompts');

const catalogPath = path.resolve(
  process.cwd(),
  '../../juxin-ai-assistant/server/catalog/assistants.json'
);


describe('AI assistant prompt seed', () => {
  test('builds one published prompt per catalog task with matching ids and variables', () => {
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    const prompts = seed.buildPromptDefinitions(catalog);

    expect(prompts).toHaveLength(88);
    expect(new Set(prompts.map((item) => item.id)).size).toBe(88);
    expect(prompts.map((item) => item.id)).toEqual(
      expect.arrayContaining([1001, 1088])
    );
    for (const prompt of prompts) {
      expect(prompt.status).toBe('published');
      expect(prompt.content).toContain(`任务：${prompt.title}`);
      for (const variable of prompt.variables) {
        expect(prompt.content).toContain(`{{${variable}}}`);
      }
    }
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
});
