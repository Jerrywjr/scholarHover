import { beforeEach, describe, expect, it } from 'vitest';
import { createCache } from '../src/background/cache';
import type { ArchiveBackend, LegacyGeneratedEntry } from '../src/background/archive';
import { installChromeStorage } from './chrome-storage';
import type { Generated, Paper, PaperSeed, Resolution } from '../src/shared/types';
import { DEFAULT_SETTINGS } from '../src/shared/defaults';
import { makeFingerprint } from '../src/background/model';

const generated = (fingerprint: string, createdAt = Date.now()): Generated => ({ language: 'zh-CN', titleTranslated: '标题', abstractTranslated: '摘要', summary: '总结', model: 'm', fingerprint, createdAt });
const seed: PaperSeed = { title: 'Title', authors: ['A Researcher'], year: 2020, url: 'https://example.com/p1' };
const resolution: Resolution = { paper: { ...seed, id: 'p1', source: 'OpenAlex', sourceUrl: 'https://openalex.org/p1', matchStatus: 'matched' }, candidates: [] };

// jsdom has no IndexedDB. Exercise cache policy against a small storage adapter;
// the production IndexedDB transaction adapter is checked in browser tests.
function memoryArchive() {
  const generatedValues = new Map<string, unknown>();
  const previews = new Map<string, unknown>();
  const legacy = new Map<string, unknown>();
  const backend: ArchiveBackend = {
    async getGenerated(key) { return structuredClone(generatedValues.get(key)); },
    async putGenerated(value) { generatedValues.set(value.fingerprint, structuredClone(value)); },
    async getPreview(key) { return structuredClone(previews.get(key)); },
    async putPreview(key, value) { previews.set(key, structuredClone(value)); },
    async importLegacy(entries: LegacyGeneratedEntry[]) {
      for (const entry of entries) {
        legacy.set(entry.key, structuredClone(entry.value));
        if (entry.generated && !generatedValues.has(entry.generated.fingerprint)) {
          generatedValues.set(entry.generated.fingerprint, structuredClone(entry.generated));
        }
      }
    },
    async clear() { generatedValues.clear(); previews.clear(); legacy.clear(); },
  };
  return { backend, generatedValues, previews, legacy };
}

function setup(initial: Record<string, unknown> = {}) {
  const storage = installChromeStorage(initial);
  const archive = memoryArchive();
  const legacy = { read: () => storage.chromeMock.storage.local.get(null), remove: (keys: string[]) => storage.chromeMock.storage.local.remove(keys) };
  const cache = createCache(archive.backend, legacy);
  return { ...storage, ...archive, cache, reopen: () => createCache(archive.backend, legacy) };
}

describe('durable generated and preview archive', () => {
  let state: ReturnType<typeof setup>;
  beforeEach(() => { state = setup(); });

  it('returns a result only for its exact fingerprint', async () => {
    await state.cache.putCached(generated('one'));
    expect(await state.cache.getCached('one')).toMatchObject({ fingerprint: 'one' });
    expect(await state.cache.getCached('two')).toBeUndefined();
  });

  it('reuses a result after a UI language change but not an output language change', async () => {
    const paper: Paper = resolution.paper;
    const settings = { ...DEFAULT_SETTINGS, baseUrl: 'https://api.example.com/v1', model: 'm' };
    const fingerprint = await makeFingerprint(paper, settings);
    await state.cache.putCached(generated(fingerprint));
    expect(await state.cache.getCached(await makeFingerprint(paper, { ...settings, uiLanguage: 'en' }))).toMatchObject({ language: 'zh-CN', fingerprint });
    expect(await state.cache.getCached(await makeFingerprint(paper, { ...settings, outputLanguage: 'en' }))).toBeUndefined();
  });

  it.each(['zh-CN', 'en', 'fr', 'de'] as const)('stores and reads records labeled %s', async language => {
    await state.cache.putCached({ ...generated(language), language });
    expect(await state.cache.getCached(language)).toMatchObject({ language });
  });

  it('retains old records and more than 200 entries across archive reopening', async () => {
    for (let index = 0; index < 250; index++) await state.cache.putCached(generated(`item-${index}`, index + 1));
    const reopened = state.reopen();
    expect(await reopened.getCached('item-0')).toMatchObject({ fingerprint: 'item-0', createdAt: 1 });
    expect(await reopened.getCached('item-249')).toMatchObject({ fingerprint: 'item-249' });
    expect(state.generatedValues.size).toBe(250);
  });

  it('retains a single record larger than the former 4 MiB budget', async () => {
    const large = { ...generated('large'), abstractTranslated: '中'.repeat(2 * 1024 * 1024) };
    await state.cache.putCached(large);
    expect((await state.cache.getCached('large'))?.abstractTranslated?.length).toBe(2 * 1024 * 1024);
  });

  it('serializes concurrent writes without losing either result', async () => {
    await Promise.all([state.cache.putCached(generated('first')), state.cache.putCached(generated('second'))]);
    expect(await state.cache.getCached('first')).toMatchObject({ fingerprint: 'first' });
    expect(await state.cache.getCached('second')).toMatchObject({ fingerprint: 'second' });
  });

  it('keeps the latest result for a repeated fingerprint', async () => {
    await state.cache.putCached(generated('same', 1));
    await state.cache.putCached({ ...generated('same', 2), summary: 'new' });
    expect(await state.cache.getCached('same')).toMatchObject({ summary: 'new', createdAt: 2 });
    expect(state.generatedValues.size).toBe(1);
  });

  it('migrates aged records without changing their fingerprint or content', async () => {
    state = setup({ 'generated:old': generated('old', 1), settings: { model: 'm' } });
    expect(await state.cache.getCached('old')).toEqual(generated('old', 1));
    expect(state.local).toEqual({ settings: { model: 'm' } });
    expect(state.legacy.get('generated:old')).toEqual(generated('old', 1));
    expect(await state.reopen().getCached('old')).toEqual(generated('old', 1));
  });

  it('preserves unrecognized legacy records instead of silently deleting them', async () => {
    const old = { titleZh: '旧题目', abstractZh: '旧摘要' };
    const invalid = { ...generated('invalid'), language: 'es' };
    state = setup({ 'generated:old': old, 'generated:invalid': invalid });
    expect(await state.cache.getCached('old')).toBeUndefined();
    expect(await state.cache.getCached('invalid')).toBeUndefined();
    expect(state.legacy.get('generated:old')).toEqual(old);
    expect(state.legacy.get('generated:invalid')).toEqual(invalid);
  });

  it('does not replace a newer archived result when a legacy copy remains', async () => {
    state = setup({ 'generated:one': generated('one', 1) });
    state.generatedValues.set('one', { ...generated('one', 2), summary: 'new' });
    expect(await state.cache.getCached('one')).toMatchObject({ summary: 'new', createdAt: 2 });
  });

  it('keeps legacy source records until migration finishes successfully', async () => {
    state = setup({ 'generated:one': generated('one', 1) });
    const importLegacy = state.backend.importLegacy;
    let finish!: () => void;
    let started!: () => void;
    const startedMigration = new Promise<void>(resolve => { started = resolve; });
    state.backend.importLegacy = async entries => {
      await new Promise<void>(resolve => { finish = resolve; started(); });
      await importLegacy(entries);
    };
    const pending = state.cache.getCached('one');
    await startedMigration;
    expect(state.local['generated:one']).toEqual(generated('one', 1));
    finish();
    expect(await pending).toMatchObject({ fingerprint: 'one' });
    expect(state.local['generated:one']).toBeUndefined();
  });

  it('keeps legacy data and safely reports a migration failure, then allows retry', async () => {
    state = setup({ 'generated:one': generated('one', 1) });
    const importLegacy = state.backend.importLegacy;
    state.backend.importLegacy = async () => { throw new Error('private IndexedDB internals'); };
    await expect(state.cache.getCached('one')).rejects.toThrow(/迁移/);
    expect(state.local['generated:one']).toEqual(generated('one', 1));
    state.backend.importLegacy = importLegacy;
    expect(await state.cache.getCached('one')).toMatchObject({ fingerprint: 'one' });
  });

  it('retains committed migration data if removal of source records fails', async () => {
    state = setup({ 'generated:one': generated('one', 1) });
    state.chromeMock.storage.local.remove.mockRejectedValueOnce(new Error('private storage internals'));
    await expect(state.cache.getCached('one')).rejects.toThrow(/迁移/);
    expect(state.generatedValues.get('one')).toEqual(generated('one', 1));
    expect(state.local['generated:one']).toEqual(generated('one', 1));
    expect(await state.cache.getCached('one')).toEqual(generated('one', 1));
  });

  it('retains unresolved previews and warnings without any generation or save action', async () => {
    const unresolved: Resolution = { ...resolution, paper: { ...resolution.paper, matchStatus: 'unresolved' }, warning: 'Metadata unavailable', timings: { lookup: 12 } };
    await state.cache.putPreview(seed, unresolved);
    expect(await state.reopen().getPreview({ ...seed, venue: 'A noisy venue label' })).toEqual(unresolved);
    expect(await state.cache.getPreview({ ...seed, url: 'https://example.com/p2' })).toBeUndefined();
  });

  it('keeps archived previews independent of caller mutations', async () => {
    await state.cache.putPreview(seed, resolution);
    const first = await state.cache.getPreview(seed);
    first!.paper.title = 'changed';
    expect((await state.cache.getPreview(seed))?.paper.title).toBe('Title');
  });

  it('reports write failure and preserves existing generated results and previews', async () => {
    await state.cache.putCached(generated('one', 1));
    await state.cache.putPreview(seed, resolution);
    const putGenerated = state.backend.putGenerated;
    state.backend.putGenerated = async () => { throw new Error('secret quota details'); };
    const failed = state.cache.putCached(generated('one', 2));
    await expect(failed).rejects.toThrow(/无法保存本地归档/);
    await expect(failed).rejects.not.toThrow(/secret/);
    expect(await state.cache.getCached('one')).toEqual(generated('one', 1));
    expect(await state.cache.getPreview(seed)).toEqual(resolution);
    state.backend.putGenerated = putGenerated;
    await state.cache.putCached(generated('two', 2));
    expect(await state.cache.getCached('two')).toMatchObject({ fingerprint: 'two' });
  });

  it('surfaces read failures and malformed current records instead of causing a regeneration', async () => {
    state.backend.getGenerated = async () => { throw new Error('internal path'); };
    await expect(state.cache.getCached('one')).rejects.toThrow(/无法读取本地归档/);
    state.backend.getGenerated = async () => ({ invalid: true });
    await expect(state.cache.getCached('one')).rejects.toThrow(/无法读取本地归档/);
  });

  it('clears generated, preview and raw legacy archives while preserving savedCollection and settings', async () => {
    state = setup({ settings: { model: 'm' }, savedCollection: { revision: 1, items: [{ id: 'saved' }] }, 'generated:old': { titleZh: '旧缓存' } });
    await state.cache.putCached(generated('one'));
    await state.cache.putPreview(seed, resolution);
    await state.cache.clearCache();
    expect(await state.reopen().getCached('one')).toBeUndefined();
    expect(await state.cache.getPreview(seed)).toBeUndefined();
    expect(state.legacy.size).toBe(0);
    expect(state.local).toEqual({ settings: { model: 'm' }, savedCollection: { revision: 1, items: [{ id: 'saved' }] } });
  });
});
