import { describe, expect, it, vi } from 'vitest';
import { createLongModelGenerator, isBackgroundSender } from '../src/background/long-model';
import type { Generated, Paper, Settings } from '../src/shared/types';

const settings: Settings = { uiLanguage: 'zh-CN', outputLanguage: 'zh-CN', baseUrl: 'https://model.test/v1', model: 'slow-model', autoGenerate: true, consent: true, rememberKey: false };
const paper: Paper = { id: 'p1', title: 'Slow paper', authors: ['A'], url: 'https://example.test/p1', source: 'OpenAlex', sourceUrl: 'https://openalex.org/W1', matchStatus: 'matched', abstract: 'Evidence.' };
const generated: Generated = { language: 'zh-CN', titleTranslated: '慢论文', abstractTranslated: '证据。', summary: '该论文报告了证据。', model: 'slow-model', fingerprint: 'abc', createdAt: 1 };

describe('offscreen model bridge', () => {
  it('rejects a forged command from a Scholar tab even when the extension id matches', () => {
    expect(isBackgroundSender({ id: 'extension-id', url: 'https://scholar.google.com/scholar?q=test', tab: { id: 7 } as chrome.tabs.Tab },
      'extension-id', 'chrome-extension://extension-id/background.js')).toBe(false);
    expect(isBackgroundSender({ id: 'extension-id', url: 'chrome-extension://extension-id/background.js' },
      'extension-id', 'chrome-extension://extension-id/background.js')).toBe(true);
  });

  it('creates one offscreen document for concurrent generation and accepts only its correlated result', async () => {
    let releaseCreation!: () => void;
    const createDocument = vi.fn(() => new Promise<void>(resolve => { releaseCreation = resolve; }));
    const sendMessage = vi.fn(async (message: { requestId: string }) => ({ target: 'scholar-hover-background', requestId: message.requestId, ok: true, data: generated }));
    const generate = createLongModelGenerator({ hasDocument: async () => false, createDocument, sendMessage, randomId: () => 'job-1' });

    const first = generate(paper, settings, 'secret');
    const second = generate(paper, settings, 'secret');
    await vi.waitFor(() => expect(createDocument).toHaveBeenCalledTimes(1));
    releaseCreation();

    await expect(Promise.all([first, second])).resolves.toEqual([generated, generated]);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[0][0]).toMatchObject({ target: 'scholar-hover-offscreen', type: 'GENERATE_MODEL', paper, settings, apiKey: 'secret' });
  });

  it('rejects a response that is not correlated to the request', async () => {
    const generate = createLongModelGenerator({
      hasDocument: async () => true,
      createDocument: async () => {},
      sendMessage: async () => ({ target: 'scholar-hover-background', requestId: 'another-job', ok: true, data: generated }),
      randomId: () => 'expected-job',
    });

    await expect(generate(paper, settings, 'secret')).rejects.toThrow('模型后台返回无效');
  });

  it('preserves a bounded worker error without exposing arbitrary objects', async () => {
    const generate = createLongModelGenerator({
      hasDocument: async () => true,
      createDocument: async () => {},
      sendMessage: async (message: { requestId: string }) => ({ target: 'scholar-hover-background', requestId: message.requestId, ok: false, error: 'x'.repeat(400) }),
      randomId: () => 'job-1',
    });

    await expect(generate(paper, settings, 'secret')).rejects.toThrow('x'.repeat(300));
  });
});
