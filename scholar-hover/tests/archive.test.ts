import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIndexedDBArchive } from '../src/background/archive';
import type { Generated } from '../src/shared/types';

const generated: Generated = { fingerprint: 'one', language: 'zh-CN', titleTranslated: '标题', abstractTranslated: null, summary: null, model: 'm', createdAt: 1 };

// Control completion/abort independently of individual requests. The distinction
// matters because deleting a migration source on request success loses data when
// the surrounding transaction later aborts.
function indexedDBEvents() {
  type Handler = (() => void) | null;
  function request(result?: unknown) {
    return { result, error: null as Error | null, onsuccess: null as Handler, onerror: null as Handler, onblocked: null as Handler, onupgradeneeded: null as Handler };
  }
  const reads: ReturnType<typeof request>[] = [];
  const writes: ReturnType<typeof request>[] = [];
  const store = {
    get: vi.fn(() => { const next = request(); reads.push(next); return next; }),
    put: vi.fn(() => { const next = request(); writes.push(next); return next; }),
    clear: vi.fn(() => request()),
  };
  const transactions: Array<{
    error: Error | null; oncomplete: Handler; onabort: Handler; onerror: Handler;
    objectStore: () => typeof store; abort: () => void;
  }> = [];
  const db = {
    close: vi.fn(), onclose: null as Handler, onversionchange: null as Handler,
    transaction: vi.fn(() => {
      const tx = { error: null as Error | null, oncomplete: null as Handler, onabort: null as Handler, onerror: null as Handler, objectStore: () => store, abort: () => {} };
      transactions.push(tx);
      return tx;
    }),
  };
  const opens: ReturnType<typeof request>[] = [];
  vi.stubGlobal('indexedDB', { open: () => { const next = request(db); opens.push(next); return next; } });
  async function connect() { opens.at(-1)!.onsuccess?.(); await Promise.resolve(); }
  return { reads, writes, opens, transactions, db, store, connect };
}

afterEach(() => vi.unstubAllGlobals());

describe('IndexedDB archive transaction boundary', () => {
  it('does not report a write as durable before transaction completion', async () => {
    const events = indexedDBEvents();
    const archive = createIndexedDBArchive();
    let finished = false;
    const pending = archive.putGenerated(generated).then(() => { finished = true; });
    await events.connect();
    events.writes[0].onsuccess?.();
    await Promise.resolve();
    expect(finished).toBe(false);
    events.transactions[0].oncomplete?.();
    await pending;
    expect(finished).toBe(true);
  });

  it('rejects a read whose request succeeds but whose transaction aborts', async () => {
    const events = indexedDBEvents();
    const archive = createIndexedDBArchive();
    const pending = archive.getGenerated('one');
    await events.connect();
    events.reads[0].result = generated;
    events.reads[0].onsuccess?.();
    events.transactions[0].error = new Error('aborted');
    events.transactions[0].onabort?.();
    await expect(pending).rejects.toThrow('aborted');
  });

  it('does not finish migration until raw and generated records commit together', async () => {
    const events = indexedDBEvents();
    const archive = createIndexedDBArchive();
    let finished = false;
    const pending = archive.importLegacy([{ key: 'generated:one', value: generated, generated }]).then(() => { finished = true; });
    await events.connect();
    expect(events.db.transaction.mock.calls[0]).toEqual([['generated', 'legacyGenerated'], 'readwrite', { durability: 'strict' }]);
    events.reads[0].onsuccess?.();
    await Promise.resolve();
    expect(finished).toBe(false);
    events.transactions[0].oncomplete?.();
    await pending;
    expect(finished).toBe(true);
  });

  it('leaves a newer generated record intact when a migration is retried', async () => {
    const events = indexedDBEvents();
    const archive = createIndexedDBArchive();
    const pending = archive.importLegacy([{ key: 'generated:one', value: generated, generated }]);
    await events.connect();
    events.reads[0].result = { ...generated, createdAt: 2 };
    events.reads[0].onsuccess?.();
    events.transactions[0].oncomplete?.();
    await pending;
    expect(events.store.put.mock.calls).toEqual([[{ key: 'generated:one', value: generated }]]);
  });

  it('closes a late connection after an upgrade was blocked and allows retry', async () => {
    const events = indexedDBEvents();
    const archive = createIndexedDBArchive();
    const blocked = archive.getGenerated('one');
    events.opens[0].onblocked?.();
    await expect(blocked).rejects.toThrow(/blocked/);
    events.opens[0].onsuccess?.();
    expect(events.db.close).toHaveBeenCalledTimes(1);
    const retry = archive.getGenerated('one');
    expect(events.opens.length).toBe(2);
    await events.connect();
    events.reads[0].result = generated;
    events.reads[0].onsuccess?.();
    events.transactions[0].oncomplete?.();
    expect(await retry).toEqual(generated);
  });
});
