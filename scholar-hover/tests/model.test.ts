import { afterEach, describe, expect, it, vi } from 'vitest';
import { generatePaper, makeFingerprint, testConnection } from '../src/background/model';
import type { Paper, Settings } from '../src/shared/types';
import type { Language } from '../src/shared/languages';

const settings: Settings = { uiLanguage: 'zh-CN', outputLanguage: 'zh-CN', baseUrl: 'https://api.example.com/v1', model: 'test-model', autoGenerate: true, consent: true, rememberKey: false };
const paper: Paper = { id: 'p1', title: 'Evidence does not support 12%', authors: ['A'], year: 2024, url: 'https://doi.org/x', source: 'OpenAlex', sourceUrl: 'https://openalex.org/p1', matchStatus: 'confirmed', abstract: 'The intervention did not improve the outcome.' };

function jsonResponse(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('model generation', () => {
  it('posts only a non-streaming chat completion to the versioned base URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse('{"titleTranslated":"中文题目","abstractTranslated":"中文摘要","summary":"保留否定和数字 12%"}'));
    vi.stubGlobal('fetch', fetchMock);
    const result = await generatePaper(paper, settings, 'test-key');
    expect(result).toMatchObject({ titleTranslated: '中文题目', abstractTranslated: '中文摘要', summary: '保留否定和数字 12%', model: 'test-model', language: 'zh-CN' });
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/v1/chat/completions', expect.objectContaining({ method: 'POST', redirect: 'error', credentials: 'omit' }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ model: 'test-model' });
    expect(body).not.toHaveProperty('stream');
    expect(body.messages[1].content).toContain('did not improve');
  });

  const translations: Array<{ language: Language; promptName: string; title: string; abstract: string; summary: string }> = [
    { language: 'zh-CN', promptName: 'Simplified Chinese', title: '证据不支持 12%', abstract: '干预并未改善结果。', summary: '该干预未改善结果。' },
    { language: 'en', promptName: 'English', title: 'Evidence does not support 12%', abstract: 'The intervention did not improve the outcome.', summary: 'The intervention did not improve the outcome.' },
    { language: 'fr', promptName: 'French', title: 'Les données ne soutiennent pas 12 %', abstract: 'L’intervention n’a pas amélioré le résultat.', summary: 'L’intervention n’a pas amélioré le résultat.' },
    { language: 'de', promptName: 'German', title: 'Die Evidenz stützt 12 % nicht', abstract: 'Die Intervention verbesserte das Ergebnis nicht.', summary: 'Die Intervention verbesserte das Ergebnis nicht.' },
  ];

  it.each(translations)('requests and preserves $language output using neutral fields without changing the source', async ({ language, promptName, title, abstract, summary }) => {
    const sourceBefore = structuredClone(paper);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(JSON.stringify({ titleTranslated: title, abstractTranslated: abstract, summary })));
    vi.stubGlobal('fetch', fetchMock);
    const result = await generatePaper(paper, { ...settings, uiLanguage: 'en', outputLanguage: language }, 'test-key');
    expect(result).toMatchObject({ titleTranslated: title, abstractTranslated: abstract, summary, language });
    expect(paper).toEqual(sourceBefore);
    const { messages } = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(messages[0].content).toContain(promptName);
    expect(messages[1].content).toContain('titleTranslated');
    expect(messages[1].content).toContain('abstractTranslated');
    expect(messages[1].content).toContain('exactly one sentence');
    expect(messages[1].content).toContain(paper.title);
    expect(messages[1].content).toContain(paper.abstract);
  });

  it.each(translations)('discards invented abstract and summary in $language when no source abstract exists', async ({ language, title, abstract, summary }) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(JSON.stringify({ titleTranslated: title, abstractTranslated: abstract, summary })));
    vi.stubGlobal('fetch', fetchMock);
    const result = await generatePaper({ ...paper, abstract: undefined }, { ...settings, outputLanguage: language }, 'test-key');
    expect(result).toMatchObject({ titleTranslated: title, abstractTranslated: null, summary: null, language });
    const { messages } = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(messages[1].content).toContain('No abstract was provided');
    expect(messages[1].content).toContain('must be null');
  });

  it.each([
    ['zh-CN', '第一句。第二句。'],
    ['en', 'The method improves accuracy. It remains costly.'],
    ['fr', 'La méthode améliore la précision. Elle reste coûteuse.'],
    ['de', 'Die Methode verbessert die Genauigkeit. Sie bleibt teuer.'],
    ['fr', 'Une ligne\nUne autre ligne'],
    ['de', '12345'],
  ] as const)('rejects multi-sentence or non-sentence summaries for %s', async (language, summary) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(JSON.stringify({ titleTranslated: 'Title', abstractTranslated: 'Abstract', summary }))));
    await expect(generatePaper(paper, { ...settings, outputLanguage: language }, 'test-key')).rejects.toThrow('模型返回格式无效');
  });

  it.each([
    ['en', 'The improvement was 1.5% under this condition.'],
    ['fr', 'Le gain est de 1,5 % dans cette condition.'],
    ['de', 'Der Gewinn beträgt unter dieser Bedingung 1,5 %.'],
  ] as const)('accepts a single %s sentence containing decimal punctuation', async (language, summary) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(JSON.stringify({ titleTranslated: 'Title', abstractTranslated: 'Abstract', summary }))));
    await expect(generatePaper(paper, { ...settings, outputLanguage: language }, 'test-key')).resolves.toMatchObject({ summary, language });
  });

  it.each([
    ['de', 'Die Methode verbessert die Genauigkeit, z. B. bei kleinen Datensätzen.'],
    ['de', 'Die Studie verwendet den Referenzdatensatz, d. h. ImageNet, zum Training.'],
    ['fr', 'Le modèle utilise des jeux de données publics, p. ex. ImageNet, pour l’entraînement.'],
    ['de', 'Die Genauigkeit steigt in der 2. Phase um 1,5 %.'],
    ['de', 'Die Genauigkeit steigt am 3. Tag um 1.5 %.'],
  ] as const)('preserves a plausible %s sentence with a common abbreviation or ordinal', async (language, summary) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(JSON.stringify({ titleTranslated: 'Title', abstractTranslated: 'Abstract', summary }))));
    await expect(generatePaper(paper, { ...settings, outputLanguage: language }, 'test-key')).resolves.toMatchObject({ summary, language });
  });

  it.each([
    ['de', 'Die Methode hilft, z. B. bei kleinen Datensätzen. Sie bleibt teuer.'],
    ['de', 'Der Wert beträgt 3. Die Messung ist ungenau.'],
    ['fr', 'La méthode aide, p. ex. sur de petits jeux de données. Elle reste coûteuse.'],
  ] as const)('still rejects clear %s sentence boundaries next to abbreviations or numbers', async (language, summary) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(JSON.stringify({ titleTranslated: 'Title', abstractTranslated: 'Abstract', summary }))));
    await expect(generatePaper(paper, { ...settings, outputLanguage: language }, 'test-key')).rejects.toThrow('模型返回格式无效');
  });

  it('rejects malformed model output', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse('{"titleTranslated":"only title"}')));
    await expect(generatePaper(paper, settings, 'test-key')).rejects.toThrow('模型返回格式无效');
  });

  it('rejects empty required output strings', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse('{"titleTranslated":"","abstractTranslated":"","summary":""}')));
    await expect(generatePaper(paper, settings, 'test-key')).rejects.toThrow('模型返回格式无效');
  });

  it('rejects a multi-sentence or non-Chinese summary', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse('{"titleTranslated":"中文题目","abstractTranslated":"中文摘要","summary":"First sentence. Second sentence."}')));
    await expect(generatePaper(paper, settings, 'test-key')).rejects.toThrow('模型返回格式无效');
  });

  it('rejects an abstract that exceeds the complete-translation input limit before sending it', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(generatePaper({ ...paper, abstract: 'a'.repeat(12_001) }, settings, 'test-key')).rejects.toThrow('摘要过长');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects missing consent before sending a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(generatePaper(paper, { ...settings, consent: false }, 'test-key')).rejects.toThrow('确认');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps authorization errors without exposing provider text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('key=test-key', { status: 401 })));
    await expect(generatePaper(paper, settings, 'test-key')).rejects.toThrow('API Key 无效或未获授权');
  });

  it('maps rate-limit errors without exposing provider text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('key=test-key', { status: 429 })));
    await expect(generatePaper(paper, settings, 'test-key')).rejects.toThrow('请求过于频繁，请稍后重试');
  });

  it('rejects output fields beyond the response limits', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(JSON.stringify({ titleTranslated: '中'.repeat(1_001), abstractTranslated: '摘要', summary: '总结' }))));
    await expect(generatePaper(paper, settings, 'test-key')).rejects.toThrow('模型返回格式无效');
  });

  it('allows a response body to complete after 40 seconds without retrying', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('crypto', { subtle: { digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer) } });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        setTimeout(() => {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ choices: [{ message: { content: '{"titleTranslated":"中文题目","abstractTranslated":"完整摘要","summary":"保留完整结论。"}' } }] })));
          controller.close();
        }, 40_000);
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = expect(generatePaper(paper, settings, 'test-key')).resolves.toMatchObject({ abstractTranslated: '完整摘要' });
    await vi.advanceTimersByTimeAsync(40_000);
    await result;
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('allows a non-streaming model response to begin after 40 seconds', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('crypto', { subtle: { digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer) } });
    const fetchMock = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(jsonResponse('{"titleTranslated":"中文题目","abstractTranslated":"完整摘要","summary":"保留完整结论。"}')), 40_000);
      options.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const result = generatePaper(paper, settings, 'test-key');
    await vi.advanceTimersByTimeAsync(40_000);
    await expect(result).resolves.toMatchObject({ abstractTranslated: '完整摘要' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('bounds generation response waiting at 90 seconds', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('crypto', { subtle: { digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer) } });
    const fetchMock = vi.fn((_url: string, options: RequestInit) => new Promise((_, reject) => options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
    vi.stubGlobal('fetch', fetchMock);
    const promise = generatePaper(paper, settings, 'test-key');
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledOnce();
    const observed = promise.catch(error => error as Error);
    await vi.advanceTimersByTimeAsync(90_000);
    await expect(observed).resolves.toMatchObject({ message: '模型在 90 秒内未开始返回结果，请手动重试或检查模型服务。' });
    vi.useRealTimers();
  });

  it('bounds a stalled response body to 90 seconds and identifies an incomplete response', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('crypto', { subtle: { digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer) } });
    const stalled = new ReadableStream<Uint8Array>({ start() {} });
    const fetchMock = vi.fn().mockResolvedValue(new Response(stalled, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const promise = generatePaper(paper, settings, 'test-key');
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledOnce();
    const observed = promise.catch(error => error as Error);
    await vi.advanceTimersByTimeAsync(90_000);
    await expect(observed).resolves.toMatchObject({ message: '模型已响应，但 90 秒内未返回完整结果，请手动重试。' });
    vi.useRealTimers();
  });

  it('retains the 25 second limit for the short connection test', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, options: RequestInit) => new Promise((_, reject) => options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
    vi.stubGlobal('fetch', fetchMock);
    const result = testConnection(settings, 'test-key').catch(error => error as Error);
    await vi.advanceTimersByTimeAsync(25_000);
    await expect(result).resolves.toMatchObject({ message: '请求超时，请稍后重试' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('rejects an oversized response body before parsing it', async () => {
    const bytes = new Uint8Array(128 * 1024 + 1);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }), { status: 200 })));
    await expect(generatePaper(paper, settings, 'test-key')).rejects.toThrow('模型返回内容过长');
  });

  it('includes paper content, endpoint, model and prompt version in its fingerprint', async () => {
    await expect(makeFingerprint(paper, settings)).resolves.toEqual(await makeFingerprint(paper, settings));
    await expect(makeFingerprint({ ...paper, title: 'different' }, settings)).resolves.not.toEqual(await makeFingerprint(paper, settings));
    await expect(makeFingerprint(paper, { ...settings, model: 'other' })).resolves.not.toEqual(await makeFingerprint(paper, settings));
  });

  it('separates output languages while reusing the fingerprint for UI language changes', async () => {
    const chinese = await makeFingerprint(paper, settings);
    const fingerprints = await Promise.all(['zh-CN', 'en', 'fr', 'de'].map((outputLanguage) => makeFingerprint(paper, { ...settings, outputLanguage: outputLanguage as Language })));
    expect(new Set(fingerprints).size).toBe(4);
    for (const uiLanguage of ['zh-CN', 'en', 'fr', 'de'] as const) {
      expect(await makeFingerprint(paper, { ...settings, uiLanguage })).toEqual(chinese);
    }
  });

  it('validates connection endpoints before issuing a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(testConnection({ ...settings, baseUrl: 'http://api.example.com' }, 'test-key')).rejects.toThrow(/HTTPS/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a nominally successful connection response without completion content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    await expect(testConnection(settings, 'test-key')).rejects.toThrow('模型返回格式无效');
  });
});
