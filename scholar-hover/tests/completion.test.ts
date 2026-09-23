import { describe, expect, it, vi } from 'vitest';
import { createCompletionQueue } from '../src/background/completion';
import { createCollectionStore } from '../src/background/collection';
import type { Paper, Resolution } from '../src/shared/types';

describe('metadata retry recovery', () => {
  it('keeps the paid title but reports a failed abstract refresh instead of marking it complete', async () => {
    const paper: Paper = { id: 'p1', title: 'Paper', authors: ['A Smith'], url: 'https://journal.example/paper', sourceUrl: 'https://journal.example/paper', source: 'Original page', matchStatus: 'matched' };
    const title = { language: 'zh-CN' as const, titleTranslated: '标题译文', abstractTranslated: null, summary: null, model: 'fixture', fingerprint: 'title', createdAt: 1 };
    let storage: unknown;
    const collection = createCollectionStore({ read: async () => storage, write: async value => { storage = structuredClone(value); } });
    await collection.save(paper, title, { seed: paper, completion: { status: 'queued', updatedAt: 1, refreshMetadata: true } });
    const finish = vi.fn(async () => {});
    const generate = vi.fn(async () => title);
    const queue = createCompletionQueue({ collection, resolve: async () => ({ paper, candidates: [], warning: '原文读取失败：HTTP 503' }), cached: async () => title, generate, finish });
    queue.kick(); await queue.idle();
    expect((await collection.list()).items[0]).toMatchObject({ generated: title, completion: { status: 'failed', error: '原文读取失败：HTTP 503' } });
    expect(generate).not.toHaveBeenCalled(); expect(finish).not.toHaveBeenCalled();
  });
  it.each(['queued', 'resolving'] as const)('preserves explicit refresh after recovery from %s', async previous => {
    const paper: Paper = { id: 'p1', title: 'Paper', authors: ['A Smith'], url: 'https://journal.example/paper', sourceUrl: 'https://journal.example/paper', source: 'Original page', matchStatus: 'matched' };
    let storage: unknown;
    const collection = createCollectionStore({ read: async () => storage, write: async value => { storage = structuredClone(value); } });
    await collection.save(paper, undefined, { seed: paper, completion: { status: previous, updatedAt: 1, refreshMetadata: true } });
    let release!: (value: Resolution) => void;
    const resolve = vi.fn((_seed: unknown, _retry?: boolean) => new Promise<Resolution>(done => { release = done; }));
    const queue = createCompletionQueue({ collection, resolve, cached: async () => undefined, generate: async () => { throw new Error('No model used in this test'); }, finish: async () => {} });
    await queue.resume();
    await vi.waitFor(() => expect(resolve).toHaveBeenCalled());
    try {
      expect(resolve).toHaveBeenCalledWith(paper, true);
      expect((await collection.list()).items[0].completion).toMatchObject({ status: 'resolving', refreshMetadata: true });
    } finally { release({ paper, candidates: [] }); await queue.idle(); }
  });
});
