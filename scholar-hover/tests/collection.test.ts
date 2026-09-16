import { describe, expect, it, vi } from 'vitest';
import { createCollectionStore } from '../src/background/collection';
import type { CollectionSnapshot, Generated, Paper } from '../src/shared/types';

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

describe('saved paper collection', () => {
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
