import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadBlobFromResponse, openLocalWordFile } from '../src/runtime/downloads';

describe('web downloads', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete window.__TAURI_INTERNALS__;
    delete window.__JUXIN_RUNTIME_PLATFORM__;
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:download-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete window.__JUXIN_RUNTIME_PLATFORM__;
    vi.useRealTimers();
  });

  it('downloads response blob through a browser anchor', async () => {
    vi.useFakeTimers();
    const click = vi.fn();
    const appendChild = vi.spyOn(document.body, 'appendChild');
    const removeChild = vi.spyOn(document.body, 'removeChild');
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const element = document.createElementNS('http://www.w3.org/1999/xhtml', tagName) as HTMLAnchorElement;
      if (tagName === 'a') element.click = click;
      return element as HTMLElement;
    });
    const response = new Response(new Blob(['docx']), {
      headers: {
        'Content-Disposition': "attachment; filename*=UTF-8''%E6%B5%8B%E8%AF%95.docx",
      },
    });

    const fileName = await downloadBlobFromResponse(response, 'fallback.docx');

    expect(fileName).toBe('测试.docx');
    expect(click).toHaveBeenCalledTimes(1);
    expect(appendChild).toHaveBeenCalledTimes(1);
    expect(removeChild).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    vi.runAllTimers();

    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('falls back to plain filename disposition', async () => {
    const response = new Response(new Blob(['docx']), {
      headers: {
        'Content-Disposition': 'attachment; filename="plain.docx"',
      },
    });

    await expect(downloadBlobFromResponse(response, 'fallback.docx')).resolves.toBe('plain.docx');
  });

  it('does not try to open local files in web mode', async () => {
    await expect(openLocalWordFile('/Users/example/result.docx')).resolves.toBe('unsupported');
  });

  it('uses browser download for generation export in web mode', async () => {
    vi.resetModules();
    const invokeMock = vi.fn();
    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: invokeMock,
    }));
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:generation-download');
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const element = document.createElementNS('http://www.w3.org/1999/xhtml', tagName) as HTMLAnchorElement;
      if (tagName === 'a') element.click = vi.fn();
      return element as HTMLElement;
    });
    window.__JUXIN_RUNTIME_PLATFORM__ = 'web';
    window.__TAURI_INTERNALS__ = { metadata: { currentWebview: { label: 'workspace' } } };
    const fetchMock = vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(new Blob(['docx']), {
        headers: {
          'Content-Disposition': 'attachment; filename="generation.docx"',
        },
      }),
    );
    const { downloadGenerationWord } = await import('../src/api/client');

    await expect(downloadGenerationWord('generation-1')).resolves.toEqual({ kind: 'browser' });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ai/generations/generation-1/export.docx',
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(invokeMock).not.toHaveBeenCalledWith('generation_word_save', expect.anything());
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('uses browser download for chat word export in web mode even with stale tauri internals', async () => {
    vi.resetModules();
    const invokeMock = vi.fn();
    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: invokeMock,
    }));
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:chat-export-download');
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const element = document.createElementNS('http://www.w3.org/1999/xhtml', tagName) as HTMLAnchorElement;
      if (tagName === 'a') element.click = vi.fn();
      return element as HTMLElement;
    });
    window.__JUXIN_RUNTIME_PLATFORM__ = 'web';
    window.__TAURI_INTERNALS__ = { metadata: { currentWebview: { label: 'workspace' } } };
    const fetchMock = vi.spyOn(window, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/export/word') {
        return Response.json(
          {
            file_name: '聊天回答.docx',
            download_url: '/api/export/download/chat-export',
          },
          { status: 201 },
        );
      }
      if (url === '/api/export/download/chat-export') {
        return new Response(new Blob(['docx']), {
          headers: {
            'Content-Disposition': 'attachment; filename="chat-export.docx"',
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    const { exportChatWord } = await import('../src/api/chat');

    await expect(
      exportChatWord({
        conversationId: 'conversation-1',
        exportType: 'single_answer',
      }),
    ).resolves.toEqual({ kind: 'browser' });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/export/word',
      expect.objectContaining({
        credentials: 'include',
        headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/export/download/chat-export',
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(invokeMock).not.toHaveBeenCalledWith('generation_word_save', expect.anything());
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });
});
