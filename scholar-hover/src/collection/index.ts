import { rpc } from '../shared/rpc.ts';
import { buildMarkdown } from '../shared/export.ts';
import { LANGUAGES, LANGUAGE_NAMES, type Language } from '../shared/languages.ts';
import { localizeError } from '../shared/errors.ts';
import type { CollectionSnapshot, ExportBatch, Request, SavedPaper, SettingsView } from '../shared/types.ts';
import { collectionText, type CollectionMessageKey } from './messages.ts';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}
function required<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing collection element: ${id}`);
  return result as T;
}
function safeLink(url: string, text: string): HTMLAnchorElement | undefined {
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) return;
    const link = element('a', text);
    link.href = parsed.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    return link;
  } catch { return; }
}

export function startCollectionPage(): () => void {
  const page = required('collection-page');
  const list = required<HTMLOListElement>('paper-list');
  const preview = required<HTMLTextAreaElement>('markdown-preview');
  const downloads = required('download-status');
  const status = required('collection-status');
  const count = required('paper-count');
  const empty = required('collection-empty');
  let language: Language = 'zh-CN';
  let collection: CollectionSnapshot = { revision: 0, items: [] };
  let exportBatch: ExportBatch | undefined;
  let collectionSignature = '';
  let downloadSignature = '';
  let ready = false;
  let busy = true;
  let stopped = false;
  let dragging: string | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let polling = false;
  let exportRequestVersion = 0;
  let refreshNeeded = false;
  let pendingRefresh = false;
  const text = (key: CollectionMessageKey, values?: Record<string, string | number>) => collectionText(language, key, values);
  const announce = (message: string, failure = false) => {
    status.textContent = message; status.dataset.state = failure ? 'error' : 'ok';
  };
  const pendingDownloads = () => exportBatch !== undefined && [exportBatch.markdown, ...exportBatch.items].some(item => item.state === 'queued' || item.state === 'downloading');
  const updateControls = () => {
    page.setAttribute('aria-busy', String(busy));
    for (const control of page.querySelectorAll<HTMLButtonElement>('button[data-action]')) {
      const action = control.dataset.action;
      const id = control.closest<HTMLElement>('[data-paper-id]')?.dataset.paperId;
      const index = collection.items.findIndex(item => item.id === id);
      control.disabled = busy || (action !== 'refresh' && !ready)
        || ((action === 'export' || action === 'clear') && collection.items.length === 0)
        || (action === 'export' && pendingDownloads())
        || (action === 'up' && index === 0)
        || (action === 'down' && index === collection.items.length - 1);
      if (action === 'drag') control.draggable = !control.disabled;
    }
  };
  const setBusy = (value: boolean) => { busy = value; updateControls(); };
  const button = (action: string, label: string, title?: string): HTMLButtonElement => {
    const result = element('button', label);
    result.type = 'button'; result.dataset.action = action;
    if (title) result.setAttribute('aria-label', text('moveLabel', { action: label, title }));
    return result;
  };
  const renderLanguage = () => {
    document.documentElement.lang = language;
    document.title = text('pageTitle');
    page.querySelectorAll<HTMLElement>('[data-i18n]').forEach(node => { node.textContent = text(node.dataset.i18n as CollectionMessageKey); });
    preview.setAttribute('aria-label', text('previewLabel'));
    page.querySelector('.collection-toolbar')!.setAttribute('aria-label', text('collectionHeading'));
  };
  const appendField = (dl: HTMLDListElement, label: CollectionMessageKey, value: string) => {
    dl.append(element('dt', text(label)), element('dd', value));
  };
  const renderPaper = (saved: SavedPaper, index: number, isOpen: boolean): HTMLLIElement => {
    const { paper, generated } = saved;
    const row = element('li', undefined, 'paper-card'); row.dataset.paperId = saved.id;
    const gutter = element('div', undefined, 'paper-gutter');
    const number = element('span', String(index + 1), 'paper-number'); number.setAttribute('aria-hidden', 'true');
    const handle = button('drag', '⠿'); handle.className = 'drag-handle'; handle.draggable = true;
    handle.setAttribute('aria-label', text('moveLabel', { action: text('drag'), title: paper.title })); handle.title = text('drag');
    gutter.append(number, handle);
    const content = element('div');
    const title = element('h3', paper.title, 'paper-title'); title.tabIndex = -1;
    content.append(title);
    if (generated) content.append(element('p', generated.titleTranslated, 'paper-translated'));
    const metadata = [paper.authors.join(', '), paper.year, paper.venue].filter(Boolean).join(' · ');
    if (metadata) content.append(element('p', metadata, 'paper-meta'));
    if (paper.matchStatus === 'unresolved') content.append(element('p', text('uncertain'), 'uncertain'));
    const actions = element('div', undefined, 'paper-actions');
    actions.append(button('up', text('up'), paper.title), button('down', text('down'), paper.title));
    const original = safeLink(paper.url, text('original')); if (original) actions.append(original);
    const remove = button('remove', text('remove'), paper.title); remove.className = 'danger'; actions.append(remove);
    content.append(actions);
    const details = element('details', undefined, 'paper-details'); details.open = isOpen;
    details.append(element('summary', text('details')));
    const fields = element('dl');
    if (paper.abstract && generated?.summary) appendField(fields, 'summary', generated.summary);
    appendField(fields, 'abstract', paper.abstract || text('noAbstract'));
    if (paper.abstract && generated?.abstractTranslated) appendField(fields, 'translation', generated.abstractTranslated);
    details.append(fields);
    if (!generated) details.append(element('p', text('noGeneration'), 'hint'));
    if (generated) details.append(element('p', text('generatedIn', { language: LANGUAGE_NAMES[generated.language], model: generated.model }), 'hint'));
    const sources = element('div', undefined, 'source-links');
    const entries = paper.sources?.length ? paper.sources : [{ name: paper.source, url: paper.sourceUrl }];
    for (const source of entries) {
      const link = safeLink(source.url, `${text('source')} · ${source.name}`);
      if (link) sources.append(link);
    }
    if (sources.childElementCount) details.append(sources);
    const date = new Date(saved.savedAt);
    details.append(element('p', text('savedAt', { date: Number.isFinite(date.getTime()) ? date.toLocaleString(language) : text('dateUnknown') }), 'hint'));
    content.append(details); row.append(gutter, content);
    return row;
  };
  const renderCollection = () => {
    const nextSignature = JSON.stringify([language, collection]);
    count.textContent = text('count', { count: collection.items.length });
    empty.hidden = collection.items.length > 0;
    if (nextSignature === collectionSignature) { updateControls(); return; }
    const openItems = new Set(Array.from(list.querySelectorAll<HTMLLIElement>('li')).filter(row => row.querySelector('details')?.open).map(row => row.dataset.paperId));
    const focused = document.activeElement instanceof HTMLElement && list.contains(document.activeElement) ? document.activeElement : undefined;
    const focusId = focused?.closest<HTMLElement>('[data-paper-id]')?.dataset.paperId;
    const focusAction = focused?.dataset.action;
    const focusSummary = focused?.tagName === 'SUMMARY';
    list.replaceChildren(...collection.items.map((saved, index) => renderPaper(saved, index, openItems.has(saved.id))));
    const markdown = buildMarkdown(collection.items, language);
    if (preview.value !== markdown) {
      const start = preview.selectionStart, end = preview.selectionEnd, top = preview.scrollTop;
      preview.value = markdown; preview.setSelectionRange(Math.min(start, markdown.length), Math.min(end, markdown.length)); preview.scrollTop = top;
    }
    collectionSignature = nextSignature;
    updateControls();
    if (focused) {
      const row = Array.from(list.children).find(node => (node as HTMLElement).dataset.paperId === focusId);
      const replacement = focusSummary ? row?.querySelector('summary') : Array.from(row?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(node => node.dataset.action === focusAction && !node.disabled);
      if (replacement instanceof HTMLElement) replacement.focus({ preventScroll: true });
      else if (row) row.querySelector<HTMLElement>('h3')?.focus({ preventScroll: true });
      else { const heading = required('collection-heading'); heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    }
  };
  const renderDownloads = () => {
    const nextSignature = JSON.stringify([language, exportBatch]);
    if (nextSignature === downloadSignature) { updateControls(); return; }
    const fragment = document.createDocumentFragment();
    if (!exportBatch) fragment.append(element('p', text('noDownloads'), 'hint'));
    else {
      const entries = [{ ...exportBatch.markdown, title: text('markdown'), id: 'markdown', number: undefined, pageUrl: undefined, authOpened: false }, ...exportBatch.items];
      for (const item of entries) {
        const row = element('div', undefined, 'download-item'); row.dataset.downloadId = item.id;
        row.append(element('p', `${item.number ? `${item.number}. ` : ''}${item.title}`, 'download-title'));
        const state = element('span', text(item.state), 'download-state'); state.dataset.state = item.state;
        row.append(state, element('p', item.filename, 'download-filename'));
        if (item.error) row.append(element('p', localizeError(item.error, language), 'download-error'));
        if (item.state === 'failed' && item.pageUrl) {
          if (item.authOpened) row.append(element('p', text('sourceOpened'), 'hint'));
          const actions = element('div', undefined, 'download-actions');
          const source = safeLink(item.pageUrl, text('sourcePage')); if (source) actions.append(source);
          const retry = button('retry', text('retry')); retry.dataset.itemId = item.id; actions.append(retry);
          row.append(actions);
        }
        fragment.append(row);
      }
    }
    downloads.replaceChildren(fragment); downloadSignature = nextSignature; updateControls();
  };
  const clearPoll = () => { if (pollTimer !== undefined) clearTimeout(pollTimer); pollTimer = undefined; };
  const schedulePoll = () => {
    clearPoll();
    if (!stopped && !document.hidden && pendingDownloads()) pollTimer = setTimeout(() => { void poll(); }, 1500);
  };
  const poll = async () => {
    if (stopped || document.hidden) return;
    if (polling || busy) { schedulePoll(); return; }
    polling = true;
    const requestVersion = ++exportRequestVersion;
    try {
      const result = await rpc<ExportBatch | undefined>({ type: 'GET_EXPORT' });
      if (stopped || requestVersion !== exportRequestVersion) return;
      exportBatch = result; renderDownloads(); schedulePoll();
    } catch (error) {
      if (stopped || requestVersion !== exportRequestVersion) return;
      announce(localizeError(error instanceof Error ? error.message : '', language), true);
      // Do not loop forever when the worker cannot be reached. Refresh is explicit.
      clearPoll();
    } finally { polling = false; }
  };
  const refresh = async (announceLoading = true) => {
    if (stopped) return;
    if (busy && !pendingRefresh) { refreshNeeded = true; return; }
    if (pendingRefresh) return;
    pendingRefresh = true; setBusy(true);
    const requestVersion = ++exportRequestVersion;
    if (announceLoading) announce(text('loading'));
    try {
      const results = await Promise.allSettled([
        rpc<SettingsView>({ type: 'GET_SETTINGS' }), rpc<CollectionSnapshot>({ type: 'GET_COLLECTION' }), rpc<ExportBatch | undefined>({ type: 'GET_EXPORT' }),
      ]);
      if (stopped) return;
      if (results[0].status === 'fulfilled' && LANGUAGES.includes(results[0].value.uiLanguage)) language = results[0].value.uiLanguage;
      renderLanguage();
      if (results[1].status === 'fulfilled') { collection = results[1].value; ready = true; renderCollection(); }
      if (results[2].status === 'fulfilled' && requestVersion === exportRequestVersion) { exportBatch = results[2].value; renderDownloads(); }
      const error = results.find(result => result.status === 'rejected');
      if (error?.status === 'rejected') announce(localizeError(error.reason instanceof Error ? error.reason.message : '', language), true);
      else if (announceLoading) announce(text('updated'));
      schedulePoll();
    } finally {
      pendingRefresh = false;
      if (!stopped) { setBusy(false); if (refreshNeeded) { refreshNeeded = false; void refresh(false); } }
    }
  };
  const mutate = async (request: Request, progress: CollectionMessageKey, done: CollectionMessageKey) => {
    if (busy || !ready || stopped) return;
    setBusy(true); announce(text(progress));
    // A GET_EXPORT already in flight must not replace a newer retry/export job.
    if (request.type === 'EXPORT_COLLECTION' || request.type === 'RETRY_DOWNLOAD') ++exportRequestVersion;
    try {
      const result = await rpc<CollectionSnapshot | ExportBatch>(request);
      if (stopped) return;
      if (request.type === 'EXPORT_COLLECTION' || request.type === 'RETRY_DOWNLOAD') { exportBatch = result as ExportBatch; renderDownloads(); schedulePoll(); }
      else { collection = result as CollectionSnapshot; renderCollection(); }
      announce(text(done));
    } catch (error) {
      if (stopped) return;
      const message = localizeError(error instanceof Error ? error.message : '', language);
      try {
        const latest = await rpc<CollectionSnapshot>({ type: 'GET_COLLECTION' });
        if (stopped) return;
        collection = latest; renderCollection(); announce(`${message} ${text('refreshAfterError')}`, true);
      } catch { if (!stopped) announce(message, true); }
    } finally {
      if (!stopped) { setBusy(false); if (refreshNeeded) { refreshNeeded = false; void refresh(false); } }
    }
  };
  const reorder = (ids: string[]) => {
    if (ids.every((id, index) => id === collection.items[index]?.id)) return;
    void mutate({ type: 'REORDER_SAVED', ids, revision: collection.revision }, 'updating', 'updated');
  };
  const onClick = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest<HTMLButtonElement>('button[data-action]');
    if (!target || target.disabled || busy) return;
    const action = target.dataset.action;
    if (action === 'refresh') { void refresh(); return; }
    if (action === 'export') { void mutate({ type: 'EXPORT_COLLECTION', revision: collection.revision }, 'exporting', 'exportStarted'); return; }
    if (action === 'retry' && exportBatch && target.dataset.itemId) { void mutate({ type: 'RETRY_DOWNLOAD', batchId: exportBatch.id, itemId: target.dataset.itemId }, 'retrying', 'exportStarted'); return; }
    if (action === 'clear') {
      if (window.confirm(text('clearConfirm'))) void mutate({ type: 'CLEAR_COLLECTION', revision: collection.revision }, 'updating', 'cleared');
      return;
    }
    const id = target.closest<HTMLElement>('[data-paper-id]')?.dataset.paperId;
    if (!id) return;
    if (action === 'remove') { void mutate({ type: 'REMOVE_SAVED', id, revision: collection.revision }, 'updating', 'updated'); return; }
    if (action === 'up' || action === 'down') {
      const ids = collection.items.map(item => item.id); const index = ids.indexOf(id);
      const next = index + (action === 'up' ? -1 : 1);
      if (index < 0 || next < 0 || next >= ids.length) return;
      [ids[index], ids[next]] = [ids[next], ids[index]]; reorder(ids);
    }
  };
  const clearDrag = () => {
    dragging = undefined;
    list.querySelectorAll<HTMLElement>('[data-drop-target], [data-dragging]').forEach(row => { delete row.dataset.dropTarget; delete row.dataset.dragging; });
  };
  const onDragStart = (event: DragEvent) => {
    if (busy || !(event.target instanceof Element) || !event.target.closest('[data-action="drag"]')) { event.preventDefault(); return; }
    const row = event.target.closest<HTMLElement>('[data-paper-id]');
    if (!row?.dataset.paperId) return;
    dragging = row.dataset.paperId; row.dataset.dragging = 'true';
    event.dataTransfer?.setData('text/plain', dragging);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (event: DragEvent) => {
    if (!dragging || busy || !(event.target instanceof Element)) return;
    const row = event.target.closest<HTMLElement>('[data-paper-id]');
    if (!row) return;
    event.preventDefault();
    list.querySelectorAll<HTMLElement>('[data-drop-target]').forEach(item => { delete item.dataset.dropTarget; });
    row.dataset.dropTarget = 'true';
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  };
  const onDrop = (event: DragEvent) => {
    const sourceId = dragging;
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-paper-id]') : null;
    clearDrag();
    if (!sourceId || busy || !row?.dataset.paperId) return;
    event.preventDefault();
    if (sourceId === row.dataset.paperId) return;
    const ids = collection.items.map(item => item.id).filter(id => id !== sourceId);
    const targetIndex = ids.indexOf(row.dataset.paperId);
    if (targetIndex < 0) return;
    const rect = row.getBoundingClientRect();
    const after = rect.height > 0 && event.clientY > rect.top + rect.height / 2;
    ids.splice(targetIndex + (after ? 1 : 0), 0, sourceId); reorder(ids);
  };
  const onFocus = () => { if (!document.hidden) void refresh(false); };
  const onVisibility = () => { if (document.hidden) clearPoll(); else void refresh(false); };
  page.addEventListener('click', onClick);
  list.addEventListener('dragstart', onDragStart);
  list.addEventListener('dragover', onDragOver);
  list.addEventListener('drop', onDrop);
  list.addEventListener('dragend', clearDrag);
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisibility);
  const stop = () => {
    stopped = true; clearPoll();
    page.removeEventListener('click', onClick); list.removeEventListener('dragstart', onDragStart);
    list.removeEventListener('dragover', onDragOver); list.removeEventListener('drop', onDrop); list.removeEventListener('dragend', clearDrag);
    window.removeEventListener('focus', onFocus); window.removeEventListener('pagehide', stop);
    document.removeEventListener('visibilitychange', onVisibility);
  };
  window.addEventListener('pagehide', stop);
  renderLanguage(); announce(text('loading')); setBusy(false); void refresh();
  return stop;
}

if (typeof document !== 'undefined' && document.getElementById('collection-page')) startCollectionPage();
