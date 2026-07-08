import { createRequire } from 'node:module';
import { describe, expect, test, vi } from 'vitest';

const require = createRequire(import.meta.url);
const service = require('../src/prompt-service');


describe('runtime prompt reader', () => {
  test('rejects a prompt that is not published', async () => {
    const db = { get: vi.fn().mockResolvedValue({ id: 7, status: 'draft' }) };

    await expect(service.getPublishedPrompt(db, 7)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  test('returns the current immutable published version', async () => {
    const db = {
      get: vi.fn().mockResolvedValue({
        prompt_id: 7,
        status: 'published',
        version_id: 11,
        version_no: 3,
        title: '工作总结',
        summary: '总结本周工作',
        content: '请总结 {{工作内容}}',
        tags_json: '["通用"]',
      }),
    };

    await expect(service.getPublishedPrompt(db, 7)).resolves.toEqual({
      prompt_id: 7,
      version_id: 11,
      version_no: 3,
      title: '工作总结',
      summary: '总结本周工作',
      content: '请总结 {{工作内容}}',
      tags: ['通用'],
      variables: ['工作内容'],
    });
    expect(db.get).toHaveBeenCalledWith(
      expect.stringContaining('v.id = p.current_version_id'),
      [7]
    );
  });

  test('selects a requested immutable version of a published prompt', async () => {
    const db = {
      get: vi.fn().mockResolvedValue({
        prompt_id: 7,
        status: 'published',
        version_id: 9,
        version_no: 2,
        title: '工作总结 v2',
        summary: '',
        content: '总结 {{工作内容}}',
        tags_json: '[]',
      }),
    };

    await service.getPublishedPrompt(db, 7, 2);

    expect(db.get).toHaveBeenCalledWith(
      expect.stringContaining('v.version_no = ?'),
      [7, 2]
    );
  });

  test('validates an exact staged version without publishing the prompt', async () => {
    const db = {
      get: vi.fn().mockResolvedValue({
        prompt_id: 7,
        version_no: 4,
        content: '草稿版本 {{工作内容}}',
      }),
    };

    await expect(service.getStagedPromptVersion(db, 7, 4)).resolves.toEqual({
      prompt_id: 7,
      version_no: 4,
      content: '草稿版本 {{工作内容}}',
    });
    expect(db.get).toHaveBeenCalledWith(
      expect.not.stringContaining("p.status = 'published'"),
      [7, 4]
    );
  });

  test('rejects a missing staged version', async () => {
    const db = { get: vi.fn().mockResolvedValue(null) };

    await expect(service.getStagedPromptVersion(db, 7, 99)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
