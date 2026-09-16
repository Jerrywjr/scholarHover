import type { CollectionSnapshot, ExportBatch, ExportItem, DownloadState } from '../shared/types';
import type { Language } from '../shared/languages';
import { buildMarkdown, paperFilename } from '../shared/export';

export interface ExportDependencies {
  read(): Promise<ExportBatch | undefined>;
  write(batch: ExportBatch): Promise<void>;
  download(options: chrome.downloads.DownloadOptions): Promise<number>;
  search(id: number): Promise<chrome.downloads.DownloadItem[]>;
  removeFile(id: number): Promise<void>;
  openPage(url: string): Promise<void>;
}
function webUrl(value: string | undefined): string | undefined {
  try {
    const url = new URL(value ?? '');
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}
const pending = (state: DownloadState) => state === 'queued' || state === 'downloading';
const busy = (batch?: ExportBatch) => batch && (pending(batch.markdown.state) || batch.items.some(item => pending(item.state)));

/** A durable, immutable numbering snapshot; only transfer states change after export. */
export function createExportManager(deps: ExportDependencies) {
  let queue = Promise.resolve();
  let pumping = false;
  function locked<T>(action: () => Promise<T>): Promise<T> {
    const result = queue.then(action, action);
    queue = result.then(() => {}, () => {});
    return result;
  }
  async function offerSource(batch: ExportBatch, item: ExportItem) {
    if (batch.authPageOpened || !webUrl(item.pageUrl)) return;
    // Open one page per batch; remaining failures expose explicit links in the manager.
    batch.authPageOpened = true;
    await deps.write(batch);
    try { await deps.openPage(item.pageUrl); item.authOpened = true; }
    catch { item.authOpened = false; }
  }
  async function fail(batch: ExportBatch, item: ExportItem, error: string, open = true) {
    item.state = 'failed'; item.error = error;
    if (open) await offerSource(batch, item);
  }
  function kick() {
    if (pumping) return;
    pumping = true;
    void (async () => {
      while (await locked(async () => {
        const batch = await deps.read();
        const item = batch?.items.find(entry => entry.state === 'queued');
        if (!batch || !item) return false;
        if (!webUrl(item.url)) await fail(batch, item, '未找到可直接下载的原文 PDF，请在原文页面获取。');
        else {
          item.state = 'downloading'; delete item.downloadId; delete item.error;
          await deps.write(batch);
          try { item.downloadId = await deps.download({ url: item.url!, filename: item.filename, conflictAction: 'uniquify', saveAs: false }); }
          catch { await fail(batch, item, '原文下载未能开始，请打开原文页面后重试。'); }
        }
        await deps.write(batch);
        return true;
      })) { /* Each Chrome call checkpoints the job before starting the next transfer. */ }
    })().catch(() => { /* GET_EXPORT exposes storage errors and reconciles interrupted starts. */ }).finally(() => { pumping = false; });
  }
  async function reconcile(batch: ExportBatch) {
    const transfers = [batch.markdown, ...batch.items];
    for (const transfer of transfers) {
      if (transfer.state !== 'downloading') continue;
      const item = 'pageUrl' in transfer ? transfer as ExportItem : undefined;
      if (transfer.downloadId === undefined) {
        transfer.state = 'failed'; transfer.error = '下载状态已中断，请手动重试。';
        continue;
      }
      const [actual] = await deps.search(transfer.downloadId);
      if (!actual) { transfer.state = 'failed'; transfer.error = '下载记录已不可用，请手动重试。'; continue; }
      if (actual.state === 'interrupted') {
        transfer.state = 'failed';
        transfer.error = actual.error === 'USER_CANCELED' ? '下载已取消，可手动重试。'
          : '下载中断，请检查网络或在原文页面完成登录认证后重试。';
        if (item && actual.error !== 'USER_CANCELED') await offerSource(batch, item);
      } else if (actual.state === 'complete') {
        const mime = actual.mime?.split(';')[0].trim().toLowerCase();
        if (item && !['application/pdf', 'application/x-pdf'].includes(mime)) {
          if (!mime || mime === 'application/octet-stream' || mime === 'binary/octet-stream') {
            // Generic headers cannot establish whether this is a PDF. Keep the
            // user's new file for inspection instead of deleting a possible PDF.
            await fail(batch, item, '文件已下载，但服务器未标明 PDF 类型，请检查下载目录或原文页面。');
            continue;
          }
          let error = '下载返回了非 PDF 内容，可能需要登录认证，请打开原文页面。';
          // Only remove the invalid file this job just created, never unrelated downloads.
          try { await deps.removeFile(transfer.downloadId); }
          catch { error = '下载返回非 PDF 内容，且无法清理该文件，请手动检查下载目录。'; }
          await fail(batch, item, error);
        } else { transfer.state = 'complete'; delete transfer.error; }
      }
    }
    if (batch.markdown.state === 'queued') { batch.markdown.state = 'failed'; batch.markdown.error = '下载状态已中断，请手动重试。'; }
    await deps.write(batch);
    return batch;
  }
  return {
    start(snapshot: CollectionSnapshot, language: Language): Promise<ExportBatch> {
      return locked(async () => {
        const prior = await deps.read();
        if (prior) await reconcile(prior);
        if (busy(prior)) throw new Error('已有下载任务进行中，请完成后再导出。');
        if (!snapshot.items.length) throw new Error('请先缓存至少一篇文章。');
        const id = crypto.randomUUID();
        const createdAt = Date.now();
        const folder = `ScholarHover/${new Date(createdAt).toISOString().replace(/[:.]/g, '-')}-${id.slice(0, 8)}`;
        const batch: ExportBatch = {
          id, createdAt, folder,
          markdown: { filename: `${folder}/articles.md`, state: 'queued' },
          items: snapshot.items.map((saved, index) => ({
            id: saved.id, number: index + 1, title: saved.paper.title,
            filename: `${folder}/${paperFilename(saved.paper, index + 1)}`,
            url: webUrl(saved.paper.downloadUrl), pageUrl: webUrl(saved.paper.url) ?? webUrl(saved.paper.sourceUrl) ?? '', state: 'queued',
          })),
        };
        const markdown = buildMarkdown(snapshot.items, language);
        await deps.write(batch);
        try {
          batch.markdown.downloadId = await deps.download({ url: `data:text/markdown;charset=utf-8,${encodeURIComponent(markdown)}`, filename: batch.markdown.filename, conflictAction: 'uniquify', saveAs: false });
          batch.markdown.state = 'downloading';
        } catch { batch.markdown.state = 'failed'; batch.markdown.error = 'Markdown 下载未能开始，请重新导出。'; }
        await deps.write(batch);
        kick();
        return structuredClone(batch);
      });
    },
    async get(): Promise<ExportBatch | undefined> {
      const batch = await locked(async () => { const value = await deps.read(); return value ? reconcile(value) : undefined; });
      if (batch?.items.some(item => item.state === 'queued')) kick();
      return batch;
    },
    retry(batchId: string, itemId: string): Promise<ExportBatch> {
      return locked(async () => {
        const batch = await deps.read();
        const item = batch?.items.find(entry => entry.id === itemId);
        if (!batch || batch.id !== batchId || !item) throw new Error('下载任务已变化，请刷新后重试。');
        if (item.state !== 'failed') throw new Error('仅可重试失败的下载。');
        item.state = 'queued'; delete item.error; delete item.downloadId;
        await deps.write(batch); kick();
        return structuredClone(batch);
      });
    },
  };
}
