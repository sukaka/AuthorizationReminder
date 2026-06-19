import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, test, vi } from 'vitest';

process.env.PROMPT_CENTER_RUNTIME_TOKEN = 'r'.repeat(32);

const require = createRequire(import.meta.url);
const service = require('../src/prompt-service');
const app = require('../src/index');
const __dirname = path.dirname(fileURLToPath(import.meta.url));


const runtimeRouteLayer = () => app._router.stack.find(
  (layer) => layer.route?.path === '/api/prompt-center/runtime/prompts/:id/published'
);


describe('runtime prompt route', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('is registered before the unified-user auth router', () => {
    const stack = app._router.stack;
    const runtimeIndex = stack.findIndex(
      (layer) => layer.route?.path === '/api/prompt-center/runtime/prompts/:id/published'
    );
    const userRouterIndex = stack.findIndex((layer) => layer.name === 'router');

    expect(runtimeIndex).toBeGreaterThanOrEqual(0);
    expect(userRouterIndex).toBeGreaterThan(runtimeIndex);
    expect(runtimeRouteLayer().route.methods.get).toBe(true);
  });

  test('forwards prompt id and requested version to the published reader', async () => {
    const published = {
      prompt_id: 7,
      version_id: 9,
      version_no: 2,
      title: '工作总结',
      summary: '',
      content: '总结 {{工作内容}}',
      tags: [],
      variables: ['工作内容'],
    };
    vi.spyOn(service, 'getPublishedPrompt').mockResolvedValue(published);
    const layer = runtimeRouteLayer();
    expect(layer).toBeDefined();
    const handler = layer.route.stack.at(-1).handle;
    const req = { params: { id: '7' }, query: { version: '2' } };
    const res = { json: vi.fn() };
    const next = vi.fn();

    await handler(req, res, next);

    expect(service.getPublishedPrompt).toHaveBeenCalledWith(expect.anything(), '7', '2');
    expect(res.json).toHaveBeenCalledWith(published);
    expect(next).not.toHaveBeenCalled();
  });

  test('compose injects the runtime token by environment reference', () => {
    const compose = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'docker-compose.yml'),
      'utf8'
    );
    const promptBlock = compose.split('\n  prompt-center-api:')[1]?.split('\n  web-prompt-center:')[0] || '';

    expect(promptBlock).toContain('PROMPT_CENTER_RUNTIME_TOKEN: ${PROMPT_CENTER_RUNTIME_TOKEN}');
    expect(promptBlock).not.toMatch(/PROMPT_CENTER_RUNTIME_TOKEN:\s*["']?[A-Za-z0-9_-]{32,}/);
  });
});
