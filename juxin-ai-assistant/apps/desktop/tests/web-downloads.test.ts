import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadBlobFromResponse, openLocalWordFile } from '../src/runtime/downloads';

describe('web downloads', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // @ts-expect-error test cleanup
    delete window.__TAURI_INTERNALS__;
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:download-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
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
});
