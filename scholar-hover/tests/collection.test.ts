import { describe, expect, it, vi } from 'vitest';
import { createCollectionStore } from '../src/background/collection';
import type { CollectionSnapshot, Generated, Paper, PaperCompletion, PaperSeed } from '../src/shared/types';

const paper = (id = 'one', patch: Partial<Paper> = {}): Paper => ({
  id, title: `Paper ${id}`, authors: ['Alice Chen'], year: 2025, abstract: 'The source abstract.',
  url: `https://example.org/${id}`, source: 'OpenAlex', sourceUrl: `https://openalex.org/${id}`,
  matchStatus: 'matched', ...patch,
});
const generated = (patch: Partial<Generated> = {}): Generated => ({
  titleTranslated: '文章', abstractTranslated: '摘要译文。', summary: '基于摘要的概述。',
  language: 'zh-CN', model: 'test-model', fingerprint: 'fingerprint', createdAt: 1, ...patch,
});
function fixture(initial?: unknown) {
  let persisted = initial;
  const write = vi.fn(async (value: CollectionSnapshot) => { persisted = structuredClone(value); });
  const store = createCollectionStore({ read: async () => structuredClone(persisted), write });
  return { store, write, persisted: () => persisted };
}

const seed: PaperSeed = { title: 'Scholar result', authors: ['Alice Chen'], url: 'https://example.org/result' };
const provisional = (): Paper => ({ ...seed, id: 'seed:one', source: 'Google Scholar', sourceUrl: seed.url, matchStatus: 'unresolved' });
const completion = (status: PaperCompletion['status']): PaperCompletion => ({ status, updatedAt: 1 });

describe('saved paper collection', () => {
  it('retains a paper read from its original page across storage reads', async () => {
    const { store } = fixture();
    const original = paper('source', { source: 'Original page' });
    await store.save(original);
    expect((await store.list()).items[0].paper).toEqual(original);
  });
  it('persists detached provisional source context immediately and deduplicates its later enriched paper', async () => {
    const { store } = fixture();
    const context = { sourceKey: 'result:one', seed: structuredClone(seed), completion: completion('queued') };
    const pending = store.save(provisional(), undefined, context);
    context.seed.title = 'Outside mutation';
    context.completion.status = 'failed';
    const saved = await pending;
    expect(saved).toMatchObject({ id: 'seed:one', sourceKey: 'result:one', seed, completion: { status: 'queued' } });
    await store.save(paper('two'));
    const enriched = await store.update(saved.id, saved.savedAt, {
      paper: paper(), generated: generated(), completion: completion('ready'), candidates: [],
    });
    expect(enriched).toMatchObject({ id: 'seed:one', savedAt: saved.savedAt, paper: { id: 'one' }, sourceKey: 'result:one', seed });
    const repeated = await store.save(provisional(), undefined, { sourceKey: 'result:one', seed, completion: completion('queued') });
    expect(repeated).toMatchObject({ id: 'seed:one', paper: paper(), generated: generated(), completion: { status: 'ready' } });
    await store.save(paper());
    expect((await store.list()).items.map(item => item.id)).toEqual(['seed:one', 'two']);
    expect((await store.list()).items[0].generated).toEqual(generated());
  });

  it('keeps an active provisional completion when the same result is saved twice', async () => {
    const { store } = fixture();
    const saved = await store.save(provisional(), undefined, { sourceKey: 'result:one', seed, completion: completion('resolving') });
    const repeated = await store.save(provisional(), undefined, { sourceKey: 'result:one', seed, completion: completion('queued') });
    expect(repeated).toMatchObject({ id: saved.id, savedAt: saved.savedAt, completion: { status: 'resolving' } });
    expect((await store.list()).items).toHaveLength(1);
  });

  it('rejects old completion jobs after deleting and re-saving within the same millisecond', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100);
    try {
      const { store } = fixture();
      const first = await store.save(provisional());
      await store.remove(first.id, 1);
      expect(await store.update(first.id, first.savedAt, { paper: paper() })).toBeUndefined();
      const replacement = await store.save(provisional());
      expect(replacement.savedAt).not.toBe(first.savedAt);
      expect(await store.update(first.id, first.savedAt, { paper: paper(), completion: completion('ready') })).toBeUndefined();
      expect((await store.list()).items).toEqual([replacement]);
    } finally {
      clock.mockRestore();
    }
  });

  it('serializes detached background patches without losing simultaneous saves', async () => {
    const { store } = fixture();
    const first = await store.save(provisional());
    const patch = { paper: paper(), candidates: [paper('candidate')], completion: completion('needs-confirmation') };
    const updating = store.update(first.id, first.savedAt, patch);
    patch.paper.title = 'Outside mutation';
    patch.candidates[0].title = 'Outside mutation';
    const saving = store.save(paper('two'));
    const listing = store.list();
    await Promise.all([updating, saving]);
    expect(await listing).toMatchObject({ revision: 3, items: [
      { id: 'seed:one', paper: { id: 'one', title: 'Paper one' }, candidates: [{ title: 'Paper candidate' }] },
      { id: 'two' },
    ] });
  });

  it('clears stale generation on source changes while retaining it for status-only patches', async () => {
    const { store } = fixture();
    const saved = await store.save(provisional());
    await store.update(saved.id, saved.savedAt, { paper: paper(), generated: generated() });
    await store.update(saved.id, saved.savedAt, { completion: completion('ready') });
    expect((await store.list()).items[0].generated).toEqual(generated());
    await store.update(saved.id, saved.savedAt, { paper: paper('one', { abstract: 'New source abstract' }) });
    expect((await store.list()).items[0].generated).toBeUndefined();
    await store.updateGenerated(paper(), generated());
    expect((await store.list()).items[0].generated).toBeUndefined();
    await store.updateGenerated(paper('one', { abstract: 'New source abstract' }), generated({ fingerprint: 'new' }));
    expect((await store.list()).items[0]).toMatchObject({ id: 'seed:one', generated: { fingerprint: 'new' } });
  });

  it('retains distinct saved identities when enrichment discovers a canonical collision with another version', async () => {
    const { store } = fixture();
    const first = await store.save(provisional(), undefined, { sourceKey: 'result:one' });
    await store.save(paper('one', { preprint: true }), generated());
    await store.update(first.id, first.savedAt, { paper: paper('one', { preprint: false }) });
    expect((await store.list()).items).toMatchObject([
      { id: 'seed:one', paper: { id: 'one', preprint: false } },
      { id: 'one', paper: { id: 'one', preprint: true }, generated: generated() },
    ]);
    expect((await store.list()).items[0].generated).toBeUndefined();
  });

  it('validates optional source, completion and candidate data without accepting malformed snapshots', async () => {
    const invalidContexts = [
      { sourceKey: '' }, { seed: { ...seed, authors: 'wrong' } },
      { completion: { status: 'unknown', updatedAt: 1 } }, { candidates: [{ id: 'bad' }] },
    ];
    for (const context of invalidContexts) {
      const { store } = fixture();
      await expect(store.save(provisional(), undefined, context as Parameters<typeof store.save>[2])).rejects.toThrow('缓存文章数据无效');
      const invalid = fixture({ revision: 1, items: [{ id: 'seed:one', paper: paper(), savedAt: 1, updatedAt: 1, ...context }] });
      await expect(invalid.store.list()).rejects.toThrow('缓存文章数据无效');
    }
    const { store } = fixture();
    const saved = await store.save(provisional());
    await expect(store.update(saved.id, saved.savedAt, { completion: { status: 'ready', updatedAt: -1 } })).rejects.toThrow('缓存文章数据无效');
    await expect(store.update('', saved.savedAt, {})).rejects.toThrow('缓存文章数据无效');
  });

  it('retains saved seed data after failed enrichment writes and allows the next update', async () => {
    let persisted: CollectionSnapshot = { revision: 0, items: [] };
    let fail = false;
    const store = createCollectionStore({
      read: async () => structuredClone(persisted),
      write: async value => { if (fail) throw new Error('storage failed'); persisted = structuredClone(value); },
    });
    const saved = await store.save(provisional());
    fail = true;
    await expect(store.update(saved.id, saved.savedAt, { paper: paper() })).rejects.toThrow('storage failed');
    expect((await store.list()).items).toEqual([saved]);
    fail = false;
    await expect(store.update(saved.id, saved.savedAt, { paper: paper('one', { abstract: '中'.repeat(1_500_000) }) })).rejects.toThrow('4 MiB');
    expect((await store.list()).items).toEqual([saved]);
    await store.update(saved.id, saved.savedAt, { paper: paper(), completion: completion('failed') });
    expect((await store.list()).items[0]).toMatchObject({ paper: { id: 'one' }, completion: { status: 'failed' } });
  });

  it('preserves first-save order and timestamp on duplicate updates without applying cache expiry', async () => {
    const { store } = fixture();
    const first = await store.save(paper(), generated());
    await store.save(paper('two'));
    await store.save(paper(), generated({ createdAt: 2 }));
    expect(await store.list()).toMatchObject({ revision: 3, items: [
      { id: 'one', savedAt: first.savedAt, generated: { createdAt: 2 } }, { id: 'two' },
    ] });
  });

  it('serializes concurrent saves and makes list wait for already queued writes', async () => {
    const { store } = fixture();
    const first = store.save(paper());
    const second = store.save(paper('two'));
    const snapshot = store.list();
    await Promise.all([first, second]);
    expect((await snapshot).items.map(item => item.id)).toEqual(['one', 'two']);
  });

  it('rejects stale deletes/reorders/clears without changing persisted data', async () => {
    const { store, write } = fixture();
    await store.save(paper());
    await store.save(paper('two'));
    const reordered = await store.reorder(['two', 'one'], 2);
    expect(reordered.revision).toBe(3);
    await expect(store.remove('one', 2)).rejects.toThrow('缓存列表已更新');
    await expect(store.reorder(['one', 'two'], 2)).rejects.toThrow('缓存列表已更新');
    await expect(store.clear(2)).rejects.toThrow('缓存列表已更新');
    expect(write).toHaveBeenCalledTimes(3);
    expect((await store.list()).items.map(item => item.id)).toEqual(['two', 'one']);
    expect((await store.remove('one', 3)).items.map(item => item.id)).toEqual(['two']);
    expect(await store.clear(4)).toEqual({ revision: 5, items: [] });
  });

  it('rejects incomplete, duplicate and unknown reorder IDs', async () => {
    const { store } = fixture();
    await store.save(paper());
    await store.save(paper('two'));
    for (const ids of [['one'], ['one', 'one'], ['one', 'other']]) {
      await expect(store.reorder(ids, 2)).rejects.toThrow('文章排序无效');
    }
    await expect(store.remove('other', 2)).rejects.toThrow('缓存文章不存在');
  });

  it('preserves generation only for unchanged input and ignores stale completed generation', async () => {
    const { store } = fixture();
    await store.save(paper(), generated());
    await store.save(paper('one', { downloadUrl: 'https://example.org/file.pdf' }));
    expect((await store.list()).items[0].generated).toEqual(generated());
    const changed = paper('one', { abstract: 'A different abstract.' });
    await store.save(changed);
    expect((await store.list()).items[0].generated).toBeUndefined();
    await store.updateGenerated(paper(), generated());
    expect((await store.list()).items[0].generated).toBeUndefined();
    await store.updateGenerated(changed, generated({ fingerprint: 'new' }));
    expect((await store.list()).items[0].generated?.fingerprint).toBe('new');
    await store.remove('one', (await store.list()).revision);
    await store.updateGenerated(changed, generated());
    expect((await store.list()).items).toEqual([]);
  });

  it('drops stale generation when publication version or authors change', async () => {
    for (const patch of [{ preprint: true }, { downloadVersion: 'submittedVersion' }, { authors: ['Other Author'] }]) {
      const { store } = fixture();
      await store.save(paper(), generated());
      await store.save(paper('one', patch));
      expect((await store.list()).items[0].generated).toBeUndefined();
    }
  });

  it('rejects the 201st record and over-budget text without evicting saved papers', async () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ id: String(i), paper: paper(String(i)), savedAt: 1, updatedAt: 1 }));
    const { store, write } = fixture({ revision: 200, items });
    await expect(store.save(paper('overflow'))).rejects.toThrow('200 篇');
    await expect(store.save(paper('0', { abstract: '中'.repeat(1_500_000) }))).rejects.toThrow('4 MiB');
    expect(write).not.toHaveBeenCalled();
    expect((await store.list()).items).toHaveLength(200);
    await store.save(paper('0'));
    expect((await store.list()).revision).toBe(201);
  });

  it('returns detached snapshots and captures inputs before queued writes', async () => {
    const { store } = fixture();
    const input = paper();
    const pending = store.save(input);
    input.authors.push('Untrusted mutation');
    const saved = await pending;
    saved.paper.title = 'Changed outside';
    const list = await store.list();
    list.items[0].paper.authors.push('Changed outside');
    expect((await store.list()).items[0].paper).toEqual(paper());
  });

  it('fails safely on malformed stored data instead of overwriting it as an empty collection', async () => {
    for (const value of [{ revision: -1, items: [] }, { revision: 1, items: [{ id: 'one' }] }, { revision: 0, items: 'wrong' }]) {
      const { store, write } = fixture(value);
      await expect(store.save(paper())).rejects.toThrow('缓存文章数据无效');
      expect(write).not.toHaveBeenCalled();
    }
  });

  it('does not lose a saved record after a failed write and permits later retries', async () => {
    let persisted: CollectionSnapshot = { revision: 0, items: [] };
    let fail = true;
    const store = createCollectionStore({
      read: async () => structuredClone(persisted),
      write: async value => { if (fail) throw new Error('storage failed'); persisted = structuredClone(value); },
    });
    await expect(store.save(paper())).rejects.toThrow('storage failed');
    fail = false;
    await store.save(paper('two'));
    expect((await store.list()).items.map(item => item.id)).toEqual(['two']);
  });
});

it('atomically rejects stale task status and paper writes after the confirmed source changes', async () => {
  const { store } = fixture();
  const original = paper('A');
  const saved = await store.save(original, undefined, { completion: completion('generating') });
  await store.update(saved.id, saved.savedAt, { paper: paper('B'), completion: completion('queued') });
  expect(await store.update(saved.id, saved.savedAt, { completion: completion('failed') }, original)).toBeUndefined();
  expect(await store.update(saved.id, saved.savedAt, { paper: original }, original)).toBeUndefined();
  expect((await store.list()).items[0]).toMatchObject({ paper: { id: 'B' }, completion: { status: 'queued' } });
});
