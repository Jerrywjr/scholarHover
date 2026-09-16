import { describe, it, expect, vi } from 'vitest';
import { createExportManager, type ExportDependencies } from '../src/background/downloads';
import type { CollectionSnapshot, ExportBatch } from '../src/shared/types';
const snapshot: CollectionSnapshot = { revision: 1, items: [
  { id: 'W2', paper: { id: 'W2', title: 'Second / paper', authors: ['A'], year: 2024, url: 'https://journal.test/paper2', downloadUrl: 'https://journal.test/2.pdf', source: 'OpenAlex', sourceUrl: 'https://openalex.org/W2', matchStatus: 'matched' }, savedAt: 1, updatedAt: 1 },
  { id: 'W1', paper: { id: 'W1', title: 'First paper', authors: ['B'], url: 'https://journal.test/paper1', source: 'OpenAlex', sourceUrl: 'https://openalex.org/W1', matchStatus: 'matched' }, savedAt: 2, updatedAt: 2 },
] };
function setup() {
  let stored: ExportBatch | undefined;
  let nextId = 1;
  const items = new Map<number, { id: number; state: string; mime: string; error?: string }>();
  const options: chrome.downloads.DownloadOptions[] = [];
  const opened: string[] = [];
  const removed: number[] = [];
  const deps: ExportDependencies = {
    read: async () => structuredClone(stored), write: async batch => { stored = structuredClone(batch); },
    download: async option => { options.push(option); const id = nextId++; items.set(id, { id, state: 'in_progress', mime: option.filename?.endsWith('.md') ? 'text/markdown' : 'application/pdf' }); return id; },
    search: async id => items.has(id) ? [items.get(id) as chrome.downloads.DownloadItem] : [],
    removeFile: async id => { removed.push(id); },
    openPage: async url => { opened.push(url); },
  };
  return { deps, manager: createExportManager(deps), items, options, opened, removed };
}
async function started(manager: ReturnType<typeof createExportManager>) {
  await vi.waitFor(async () => {
    const batch = await manager.get();
    expect(batch?.markdown.state).not.toBe('queued');
    expect(batch?.items.some(item => item.state === 'queued')).toBe(false);
  });
  return (await manager.get())!;
}
describe('numbered collection exports', () => {
  it('freezes Markdown and PDF numbering to the export order and reports unavailable originals', async () => {
    const { manager, options, opened } = setup();
    await manager.start(snapshot, 'zh-CN');
    const batch = await started(manager);
    expect(batch.items.map(item => item.id)).toEqual(['W2', 'W1']);
    expect(batch.items.map(item => item.number)).toEqual([1, 2]);
    expect(options[1].filename).toContain('/1-');
    expect(options[1].filename).not.toContain('Second /');
    const markdown = decodeURIComponent(options[0].url.split(',')[1]);
    expect(markdown.indexOf('Second')).toBeLessThan(markdown.indexOf('First paper'));
    expect(batch.items[1].state).toBe('failed');
    expect(batch.items[1].error).toBe('未找到可直接下载的原文 PDF，请在原文页面获取。');
    expect(opened).toEqual(['https://journal.test/paper1']);
  });
  it('does not mark accepted downloads complete until Chrome confirms completion', async () => {
    const { manager, items } = setup();
    await manager.start(snapshot, 'en');
    const batch = await started(manager);
    expect(batch.items[0].state).toBe('downloading');
    items.get(batch.items[0].downloadId!)!.state = 'complete';
    items.get(batch.markdown.downloadId!)!.state = 'complete';
    expect((await manager.get())?.items[0].state).toBe('complete');
    expect((await manager.get())?.markdown.state).toBe('complete');
  });
  it('rejects an HTML login response, removes only that newly downloaded file, and permits explicit retry', async () => {
    const { manager, items, removed, options } = setup();
    await manager.start(snapshot, 'en');
    let batch = await started(manager);
    const id = batch.items[0].downloadId!;
    items.set(id, { id, state: 'complete', mime: 'text/html' });
    batch = (await manager.get())!;
    expect(batch.items[0].state).toBe('failed');
    expect(removed).toEqual([id]);
    const before = options.length;
    await manager.get(); await manager.get();
    expect(options).toHaveLength(before);
    await manager.retry(batch.id, 'W2');
    batch = await started(manager);
    expect(options).toHaveLength(before + 1);
    expect(batch.items[0].downloadId).not.toBe(id);
  });
  it('recovers actual interruption after worker recreation without silently retrying', async () => {
    const { manager, deps, items, options } = setup();
    await manager.start(snapshot, 'en');
    const batch = await started(manager);
    const id = batch.items[0].downloadId!;
    items.set(id, { id, state: 'interrupted', mime: 'application/pdf', error: 'SERVER_UNAUTHORIZED' });
    const before = options.length;
    const restarted = createExportManager(deps);
    const result = await restarted.get();
    expect(result?.items[0].state).toBe('failed');
    expect(result?.items[0].error).toContain('认证');
    expect(options).toHaveLength(before);
  });
  it('keeps a possible PDF with generic MIME for manual inspection without claiming verified completion', async () => {
    const { manager, items, removed } = setup();
    await manager.start(snapshot, 'en');
    const batch = await started(manager);
    const id = batch.items[0].downloadId!;
    items.set(id, { id, state: 'complete', mime: 'application/octet-stream' });
    const result = await manager.get();
    expect(result?.items[0].state).toBe('failed');
    expect(result?.items[0].error).toContain('文件已下载');
    expect(removed).toEqual([]);
  });
  it('rejects empty exports, concurrent replacement and unknown retry IDs', async () => {
    const { manager } = setup();
    await expect(manager.start({ revision: 0, items: [] }, 'en')).rejects.toThrow();
    const batch = await manager.start(snapshot, 'en');
    await expect(manager.start(snapshot, 'en')).rejects.toThrow();
    await expect(manager.retry(batch.id, 'not-saved')).rejects.toThrow();
    await expect(manager.retry('stale-batch', 'W2')).rejects.toThrow();
  });
});
