import type { CompletionStatus, Generated, Paper, PaperSeed, Resolution, SavedPaper } from '../shared/types';
import type { createCollectionStore } from './collection';

interface Dependencies {
  collection: ReturnType<typeof createCollectionStore>;
  resolve(seed: PaperSeed, retry?: boolean): Promise<Resolution>;
  cached(paper: Paper): Promise<Generated | undefined>;
  generate(paper: Paper): Promise<Generated>;
  finish(item: SavedPaper, paper: Paper, generated: Generated): Promise<void>;
}
const pending = new Set(['queued', 'resolving', 'generating']);
export function createCompletionQueue(deps: Dependencies) {
  let running: Promise<void> | undefined;
  let recovery: Promise<void> | undefined;
  let requested = false;
  const status = (value: CompletionStatus, error?: string, refreshMetadata?: boolean) =>
    ({ status: value, updatedAt: Date.now(), ...(error ? { error } : {}), ...(refreshMetadata ? { refreshMetadata } : {}) });
  async function process(item: SavedPaper) {
    let expectedPaper = item.paper;
    const update = async (patch: Parameters<typeof deps.collection.update>[2]) => {
      const updated = await deps.collection.update(item.id, item.savedAt, patch, expectedPaper);
      if (updated) expectedPaper = updated.paper;
      return updated;
    };
    try {
      let paper = item.paper;
      if (paper.matchStatus === 'unresolved' || !paper.abstract) {
        if (!await update({ completion: status('resolving', undefined, item.completion?.refreshMetadata) })) return;
        const resolution = await deps.resolve(item.seed ?? paper, item.completion?.refreshMetadata === true);
        paper = resolution.paper;
        if (!await update({ paper, candidates: resolution.candidates })) return;
        if (resolution.candidates.length) {
          await update({ completion: status('needs-confirmation') }); return;
        }
        // Provider failures should not turn an incomplete seed into a successful
        // title-only job. The user can retry the failed metadata lookup.
        if (resolution.warning && !paper.abstract && (paper.matchStatus === 'unresolved'
          || /查询失败|读取失败|访问权限未授予/.test(resolution.warning))) {
          await update({ completion: status('failed', resolution.warning) }); return;
        }
      }
      const cached = await deps.cached(paper);
      if (cached) { await deps.finish(item, paper, cached); return; }
      if (!await update({ completion: status('generating') })) return;
      const generated = await deps.generate(paper);
      await deps.finish(item, paper, generated);
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 300) : '操作失败，请重试。';
      const configuration = /请先|模型网站访问权限未授予/.test(message);
      await update({ completion: status(configuration ? 'needs-configuration' : 'failed', message) }).catch(() => {});
    }
  }
  function kick(): void {
    requested = true;
    if (running) return;
    running = (async () => {
      // A write failure must not spin on an unchanged queued entry.
      const attempted = new Set<string>();
      while (requested) {
        requested = false;
        const snapshot = await deps.collection.list();
        for (const item of snapshot.items) {
          const token = `${item.id}:${item.savedAt}:${item.completion?.updatedAt}`;
          if (item.completion?.status !== 'queued' || attempted.has(token)) continue;
          attempted.add(token);
          await process(item);
          requested = true;
        }
      }
    })().catch(() => {}).finally(() => { running = undefined; if (requested) kick(); });
  }
  function resume(): Promise<void> {
    return recovery ??= (async () => {
      for (const item of (await deps.collection.list()).items) {
        const previous = item.completion?.status;
        if (!previous || !pending.has(previous)) continue;
        const cached = previous === 'generating' ? await deps.cached(item.paper).catch(() => undefined) : undefined;
        if (cached) await deps.finish(item, item.paper, cached);
        else await deps.collection.update(item.id, item.savedAt, { completion: previous === 'generating'
          ? status('interrupted', '后台任务已中断，请手动重试；上次模型请求可能已计费。') : status('queued', undefined, item.completion?.refreshMetadata) });
      }
      kick();
    })();
  }
  return { kick, resume, async idle() { while (running) await running; } };
}
