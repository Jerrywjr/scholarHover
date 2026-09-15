import { beforeEach, describe, expect, it } from 'vitest';
import { CACHE_MAX, CACHE_TTL } from '../src/shared/defaults';
import { clearCache, getCached, putCached } from '../src/background/cache';
import { installChromeStorage } from './chrome-storage';
import type { Generated, Paper } from '../src/shared/types';
import { DEFAULT_SETTINGS } from '../src/shared/defaults';
import { makeFingerprint } from '../src/background/model';

const generated = (fingerprint: string, createdAt = Date.now()): Generated => ({ language: 'zh-CN', titleTranslated: '标题', abstractTranslated: '摘要', summary: '总结', model: 'm', fingerprint, createdAt });

describe('generated result cache', () => {
  beforeEach(() => installChromeStorage());

  it('returns a result only for its exact fingerprint', async () => {
    await putCached(generated('one'));
    expect(await getCached('one')).toMatchObject({ fingerprint: 'one' });
    expect(await getCached('two')).toBeUndefined();
  });

  it('reuses an existing result after a UI language change but not an output language change', async () => {
    const paper: Paper = { id: 'p1', title: 'Title', authors: [], url: 'https://example.com/p1', source: 'OpenAlex', sourceUrl: 'https://openalex.org/p1', matchStatus: 'confirmed' };
    const settings = { ...DEFAULT_SETTINGS, baseUrl: 'https://api.example.com/v1', model: 'm' };
    const fingerprint = await makeFingerprint(paper, settings);
    await putCached(generated(fingerprint));
    const withEnglishUi = await makeFingerprint(paper, { ...settings, uiLanguage: 'en' });
    const withEnglishOutput = await makeFingerprint(paper, { ...settings, outputLanguage: 'en' });
    expect(await getCached(withEnglishUi)).toMatchObject({ language: 'zh-CN', fingerprint });
    expect(await getCached(withEnglishOutput)).toBeUndefined();
  });

  it('removes legacy Chinese-schema records and records without a supported language', async () => {
    const storage = installChromeStorage({
      'generated:legacy': { titleZh: '旧题目', abstractZh: '旧摘要', summary: '旧概述', model: 'm', fingerprint: 'legacy', createdAt: Date.now() },
      'generated:invalid': { ...generated('invalid'), language: 'es' },
      'generated:missing': { ...generated('missing'), language: undefined },
    });
    expect(await getCached('legacy')).toBeUndefined();
    expect(await getCached('invalid')).toBeUndefined();
    expect(await getCached('missing')).toBeUndefined();
    expect(storage.local).toEqual({});
  });

  it.each(['zh-CN', 'en', 'fr', 'de'] as const)('stores and reads records labeled %s', async (language) => {
    await putCached({ ...generated(language), language });
    expect(await getCached(language)).toMatchObject({ language });
  });

  it('drops expired results', async () => {
    await putCached(generated('old', Date.now() - CACHE_TTL - 1));
    expect(await getCached('old')).toBeUndefined();
  });

  it('evicts the oldest entries when the entry bound is exceeded', async () => {
    const startedAt = Date.now();
    for (let index = 0; index <= CACHE_MAX; index++) await putCached(generated(`item-${index}`, startedAt + index));
    expect(await getCached('item-0')).toBeUndefined();
    expect(await getCached(`item-${CACHE_MAX}`)).toMatchObject({ fingerprint: `item-${CACHE_MAX}` });
  });

  it('serializes concurrent writes so neither result is lost', async () => {
    await Promise.all([putCached(generated('first')), putCached(generated('second'))]);
    expect(await getCached('first')).toMatchObject({ fingerprint: 'first' });
    expect(await getCached('second')).toMatchObject({ fingerprint: 'second' });
  });

  it('does not retain a single record that exceeds the cache byte budget', async () => {
    await putCached({ ...generated('too-large'), abstractTranslated: '中'.repeat(4 * 1024 * 1024) });
    expect(await getCached('too-large')).toBeUndefined();
  });

  it('clears only generated cache records', async () => {
    const storage = installChromeStorage({ settings: { model: 'm' }, 'generated:legacy': { titleZh: '旧缓存' } });
    await putCached(generated('one'));
    await clearCache();
    expect(await getCached('one')).toBeUndefined();
    expect(storage.local).toEqual({ settings: { model: 'm' } });
  });
});
