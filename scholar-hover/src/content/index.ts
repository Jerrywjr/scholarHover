import { HOVER_DELAY } from '../shared/defaults.ts';
import { rpc } from '../shared/rpc.ts';
import { localizeError } from '../shared/errors.ts';
import { LANGUAGES, type Language } from '../shared/languages.ts';
import { contentText, type ContentMessageKey } from './messages.ts';
import type { CompletionStatus, Generated, Paper, PaperSeed, PreviewSnapshot, PreviewState, Resolution, SavedPaper, SettingsView } from '../shared/types.ts';

const RESULT_SELECTOR = '.gs_r.gs_or.gs_scl';
const TITLE_SELECTOR = '.gs_rt';
const CARD_ID = 'scholar-hover-card';

type Active = {
  element: Element;
  seed: PaperSeed;
  token: number;
  pinned: boolean;
  titleHovered: boolean;
  cardHovered: boolean;
  paper?: Paper;
  resolution?: Resolution;
  generated?: Generated;
  keyboard: boolean;
  focusPending: boolean;
  notice?: { key: ContentMessageKey; failure: boolean; detail?: string };
  generationPending?: string;
  outputPending?: string;
  savePending?: string;
  savedPaperId?: string;
  saved?: SavedPaper;
  previewPending?: boolean;
  previewRead?: number;
  saveNotice?: { key: ContentMessageKey; failure: boolean; detail?: string };
  collectionPending?: boolean;
  metadataPending?: boolean;
  metadataAttempted?: boolean;
  needsRefresh?: boolean;
  sourceAccessPending?: boolean;
  sourceAccessReturn?: boolean;
};

type CardFocus =
  | { kind: 'button'; action: string; candidateId?: string }
  | { kind: 'summary' }
  | { kind: 'body' }
  | { kind: 'edge'; edge: string }
  | { kind: 'link'; href: string; className: string };
type PreviewRead = { snapshot: PreviewSnapshot; configuration: string; epoch: number; failed?: boolean; error?: string };

function cleanTitle(value: string): string {
  return value.replace(/^\s*(?:\[(?:PDF|HTML)\]\s*)+/i, '').replace(/\s+/g, ' ').trim();
}

function readDoi(href: string): string | undefined {
  const match = href.match(/(?:doi\.org\/|doi:)(10\.\d{4,9}\/[\w.()/:;-]+)/i);
  return match?.[1]?.replace(/[.,;]+$/, '');
}

function isResult(element: Element): boolean {
  return element.matches(RESULT_SELECTOR);
}

/** Extract only metadata present in a Scholar search-result card. */
export function parseResult(element: Element): PaperSeed | null {
  if (!isResult(element)) return null;
  const heading = element.querySelector(TITLE_SELECTOR);
  if (!heading) return null;
  const link = heading.querySelector<HTMLAnchorElement>('a[href]');
  const title = cleanTitle((link ?? heading).textContent ?? '');
  if (!title) return null;
  const metadata = element.querySelector('.gs_a')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const parts = metadata.split(/\s+-\s+/).map(part => part.trim()).filter(Boolean);
  const authors = (parts[0] ?? '')
    .split(/\s*,\s*|\s+and\s+/i)
    .map(author => author.trim())
    .filter(author => author.length > 0 && author.length < 120);
  const yearMatch = metadata.match(/\b(18\d{2}|19\d{2}|20\d{2}|21\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : undefined;
  const venuePart = parts.find((part, index) => index > 0 && !/^\d{4}$/.test(part) && !/^https?:\/\//.test(part));
  const venue = venuePart && !/^\d{4}\b/.test(venuePart) ? venuePart.replace(/\b(18|19|20|21)\d{2}\b.*$/, '').replace(/[,:;\-\s]+$/, '').trim() : undefined;
  // Citation-only results have no paper URL; retain the current Scholar result URL so
  // the resolver receives a valid, user-visible provenance URL without inventing one.
  const url = link?.href ?? location.href;
  const doi = readDoi(url);
  const explicitPreprint = /(?:^|\.)?(?:arxiv|biorxiv|medrxiv)\.org(?:\/|$)/i.test(url)
    || /\b(?:arXiv|bioRxiv|medRxiv)\b(?:\s+preprint)?/i.test(metadata)
    || /\bpreprint\b/i.test(venue ?? '');
  return { title, authors, ...(year ? { year } : {}), ...(venue ? { venue } : {}), url, ...(doi ? { doi } : {}), ...(explicitPreprint ? { preprint: true } : {}) };
}

function resultFor(node: EventTarget | null): Element | null {
  if (!(node instanceof Element)) return null;
  if (!node.closest(TITLE_SELECTOR)) return null;
  const result = node.closest(RESULT_SELECTOR);
  if (!result || !isResult(result)) return null;
  return result.querySelector(TITLE_SELECTOR) ? result : null;
}

function isSafeUrl(value: string): boolean {
  try {
    const url = new URL(value, location.href);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch { return false; }
}

function text(parent: Element, value: string, className?: string): HTMLElement {
  const node = document.createElement('span');
  if (className) node.className = className;
  node.textContent = value;
  parent.append(node);
  return node;
}

function createHost(): HTMLElement {
  const old = document.getElementById(CARD_ID);
  old?.remove();
  const host = document.createElement('aside');
  host.id = CARD_ID;
  host.setAttribute('aria-live', 'polite');
  host.style.cssText = 'position:fixed;z-index:2147483647;display:none;overflow:hidden;right:0;top:0;width:min(420px,100vw);height:100vh;';
  host.attachShadow({ mode: 'open' });
  document.body.append(host);
  return host;
}

function addStyle(root: ShadowRoot): void {
  const style = document.createElement('style');
  style.textContent = `
    :host { color:#172b3a; font:13px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; }
    * { box-sizing:border-box; } .card { display:flex; flex-direction:column; background:#fff; border:1px solid #d9e5e8; height:100%; box-shadow:-6px 0 28px rgba(22,48,65,.18); overflow:hidden; }
    .head { flex-shrink:0; padding:16px 14px 11px; border-top:3px solid #0d6f78; } .title-group { min-width:0; } .resize-hint { display:block; color:#627d86; font-size:10px; margin-top:5px; } h2 { margin:0; min-width:0; max-height:4.2em; overflow:auto; overflow-wrap:anywhere; color:#102a43; font-size:15px; line-height:1.4; font-weight:650; } button { border:1px solid #c5d6da; border-radius:7px; background:#fff; color:#174e5a; cursor:pointer; font:inherit; padding:5px 8px; } button:hover { background:#eff7f7; } button:disabled { cursor:wait; opacity:.7; } button:focus-visible,a:focus-visible,.body:focus-visible,.resize-handle:focus-visible { outline:2px solid #1596a6; outline-offset:-2px; }
    .actions { display:flex; flex-wrap:wrap; gap:5px; margin-top:8px; } .body { flex:1 1 auto; min-height:0; overflow-y:auto; overscroll-behavior:contain; scrollbar-gutter:stable; overflow-wrap:anywhere; padding:0 14px 14px; } .meta { color:#516773; margin:0 0 9px; } .translated { color:#0d5863; margin:0 0 10px; font-size:14px; font-weight:600; } .section { border-top:1px solid #e5edef; padding-top:10px; margin-top:10px; } .label { display:block; color:#42616b; font-size:11px; font-weight:650; letter-spacing:.02em; margin-bottom:3px; } .status { color:#42616b; margin:0 0 9px; overflow-wrap:anywhere; max-height:4.7em; overflow-y:auto; } .warning { color:#805b16; background:#fff8e8; border-radius:6px; padding:7px 8px; margin:8px 0; } .sources { color:#617883; font-size:11px; margin:10px 0 0; } .source-link { color:#0d6672; } details { margin-top:8px; } summary { color:#235764; cursor:pointer; } .candidate { display:block; width:100%; text-align:left; margin:6px 0; padding:8px; } .candidate small { display:block; color:#59707b; margin-top:2px; } .footer { flex-shrink:0; max-height:55%; overflow-y:auto; overscroll-behavior:contain; padding:10px 14px 16px; border-top:1px solid #e5edef; background:#f8fbfc; } .footer-actions { display:flex; align-items:center; gap:7px; flex-wrap:wrap; } .original { color:#0d6672; text-decoration:none; } .failure { color:#a33b30; } .collection-actions { display:flex; gap:7px; flex-wrap:wrap; margin-top:9px; } [data-action="save"] { background:#0d6f78; border-color:#0d6f78; color:white; } .save-status { font-size:12px; margin-top:8px; } .resize-handle { position:absolute; z-index:2; height:8px; left:0; right:0; cursor:ns-resize; touch-action:none; } .resize-handle[data-edge="top"] { top:0; } .resize-handle[data-edge="bottom"] { bottom:0; } .resize-handle::after { content:""; position:absolute; width:48px; height:3px; border-radius:2px; background:#8fb1b7; left:calc(50% - 24px); top:2px; } .resize-handle:hover,.resize-handle:focus-visible,:host([data-resizing]) .resize-handle { background:#cce5e8; } @media (max-width:480px) { .head { padding:12px; } .body { padding:0 12px 12px; } }
  `;
  root.append(style);
}

function cardButton(label: string, action: string, pressed?: boolean): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.action = action;
  button.textContent = label;
  if (pressed !== undefined) button.setAttribute('aria-pressed', String(pressed));
  return button;
}

function appendSource(body: HTMLElement, paper: Paper, label: (key: ContentMessageKey) => string, generated?: Generated): void {
  const sources = document.createElement('p');
  sources.className = 'sources';
  const names = [`${label('source')}: ${paper.source === 'Original page' ? label('originalSource') : paper.source}`];
  if (generated) names.push(`${label('model')}: ${generated.model}`);
  sources.textContent = names.join(' · ');
  if (isSafeUrl(paper.sourceUrl)) {
    sources.append(document.createTextNode(' · '));
    const link = document.createElement('a');
    link.href = paper.sourceUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'source-link';
    link.textContent = label('recordLink');
    sources.append(link);
  }
  for (const source of paper.sources ?? []) {
    const name = source.name === 'Crossref · 摘要' ? label('crossrefAbstract') : source.name === 'Original page' ? label('originalSource') : source.name;
    sources.append(document.createTextNode(' · '));
    if (isSafeUrl(source.url)) {
      const link = document.createElement('a');
      link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.className = 'source-link'; link.textContent = name;
      sources.append(link);
    } else sources.append(document.createTextNode(name));
  }
  body.append(sources);
}

export function startContentScript(): () => void {
  if (typeof document === 'undefined' || !document.body) return () => undefined;
  const host = createHost();
  const root = host.shadowRoot!;
  addStyle(root);
  let active: Active | undefined;
  let token = 0;
  let hoverTimer: number | undefined;
  let suppressFocusTarget: Element | undefined;
  let resizing: { pointerId: number; edge: 'top' | 'bottom'; y: number; top: number; height: number } | undefined;
  let panel = { top: 0, height: window.innerHeight, fullHeight: true };
  const failedGenerationAttempts = new Set<string>();
  const viewed = new Set<string>();
  const memo = new Map<string, { snapshot: PreviewSnapshot; configuration: string }>();
  const previews = new Map<string, Promise<PreviewRead>>();
  const saving = new Map<string, Promise<SavedPaper>>();
  const seedEpoch = new Map<string, number>();
  const badgeStates = new Map<string, PreviewState>();
  const badgeReads = new Map<string, number>();
  let badgeRead = 0;
  let previewTimer: number | undefined;
  let previewRead = 0;
  let preferences: SettingsView = { uiLanguage: 'zh-CN', outputLanguage: 'zh-CN', baseUrl: '', model: '', autoGenerate: false, consent: false, rememberKey: false, hasApiKey: false, hasOpenAlexKey: false };
  let configRevision = 0;
  let settingsRead = 0;
  let stopped = false;
  let settingsReady: Promise<void>;
  const label = (key: ContentMessageKey) => contentText(key, preferences.uiLanguage, preferences.outputLanguage);
  const seedKey = (seed: PaperSeed) => JSON.stringify([seed.url, seed.title, seed.authors, seed.year, seed.doi, seed.preprint]);
  const configuration = () => JSON.stringify([preferences.outputLanguage, preferences.baseUrl, preferences.model]);
  const generationAttempt = (paper: Paper) => JSON.stringify([paper.id, preferences.outputLanguage, preferences.baseUrl, preferences.model]);
  // Match the cache's paper identity, and distinguish preprint metadata before
  // retaining an already displayed translation after an explicit source refresh.
  const outputIdentity = (paper: Paper) => JSON.stringify({
    id: paper.id, title: paper.title, authors: paper.authors, year: paper.year, venue: paper.venue,
    url: paper.url, doi: paper.doi, abstract: paper.abstract, source: paper.source, sourceUrl: paper.sourceUrl,
    preprint: paper.preprint,
  });
  const validGenerated = (generated: Generated | undefined) => generated?.language === preferences.outputLanguage
    && (!preferences.model || generated.model === preferences.model) ? generated : undefined;
  const completionPending = (saved?: SavedPaper) => saved?.completion && ['queued', 'resolving', 'generating'].includes(saved.completion.status);
  const resolutionNotice = (resolution: Resolution): ContentMessageKey => resolution.paper.matchStatus !== 'unresolved' ? 'matched'
    : resolution.candidates.length ? 'uncertain' : resolution.warning ? 'queryFailed' : 'noMatch';
  const completionLabels: Record<CompletionStatus, ContentMessageKey> = {
    queued: 'completionQueued', resolving: 'completionResolving', generating: 'completionGenerating', ready: 'completionReady',
    'needs-confirmation': 'completionConfirm', 'needs-configuration': 'completionConfigure', failed: 'completionFailed', interrupted: 'completionInterrupted',
  };
  const saveMemo = (seed: PaperSeed, snapshot: PreviewSnapshot, config = configuration()) => {
    const key = seedKey(seed); memo.delete(key); memo.set(key, { snapshot, configuration: config });
    if (snapshot.saved) badgeStates.set(key, 'saved');
    while (memo.size > 200) memo.delete(memo.keys().next().value!);
  };
  const memoSnapshot = (seed: PaperSeed): PreviewSnapshot | undefined => {
    const entry = memo.get(seedKey(seed));
    return entry ? { ...entry.snapshot, generated: entry.configuration === configuration() ? validGenerated(entry.snapshot.generated) : undefined } : undefined;
  };
  const updateBadges = () => {
    if (stopped || !host.isConnected) return;
    for (const result of document.querySelectorAll<HTMLElement>(RESULT_SELECTOR)) {
      const seed = parseResult(result); if (!seed) continue;
      const key = seedKey(seed), known = memo.get(key)?.snapshot;
      const state = saving.has(key) ? 'saving' : known?.saved ? 'saved' : viewed.has(key) || known?.resolution ? 'viewed' : badgeStates.get(key) ?? 'unknown';
      result.dataset.scholarHoverState = state;
      let badge = result.querySelector<HTMLElement>('[data-scholar-hover-badge]');
      if (state === 'unknown') { badge?.remove(); continue; }
      if (!badge) {
        badge = document.createElement('span'); badge.dataset.scholarHoverBadge = 'true';
        badge.style.cssText = 'display:inline-block;font:11px/1.5 Arial,sans-serif;border-radius:4px;padding:1px 6px;margin:2px 0 5px;background:#edf5f5;color:#47717a;';
        result.querySelector(TITLE_SELECTOR)?.insertAdjacentElement('afterend', badge);
      }
      const value = label(state === 'saving' ? 'saving' : state === 'saved' ? 'savedBadge' : state === 'viewed' ? 'viewed' : 'unviewed');
      if (badge.textContent !== value) badge.textContent = value;
    }
  };
  const requestBadgeStates = (refresh = false) => {
    if (stopped || !host.isConnected) return;
    const unique = new Map<string, PaperSeed>();
    for (const result of document.querySelectorAll(RESULT_SELECTOR)) {
      const seed = parseResult(result);
      if (seed && (refresh || !badgeReads.has(seedKey(seed)))) unique.set(seedKey(seed), seed);
    }
    const entries = Array.from(unique.entries());
    for (let offset = 0; offset < entries.length; offset += 100) {
      const batch = entries.slice(offset, offset + 100), read = ++badgeRead;
      const epochs = batch.map(([key]) => seedEpoch.get(key) ?? 0);
      for (const [key] of batch) badgeReads.set(key, read);
      void rpc<PreviewState[]>({ type: 'GET_PREVIEW_STATES', seeds: batch.map(([, seed]) => seed) }).then(states => {
        if (stopped || !host.isConnected || !Array.isArray(states)) return;
        batch.forEach(([key], index) => {
          if (badgeReads.get(key) !== read || (seedEpoch.get(key) ?? 0) !== epochs[index]) return;
          const state = states[index];
          // A failed local read is unknown, not evidence that the paper was never viewed.
          if (state === 'unviewed' || state === 'viewed' || state === 'saved') badgeStates.set(key, state);
        });
        updateBadges();
      }).catch(() => { /* Retain known states; focus refresh can retry this local read. */ });
    }
  };
  const rememberActive = () => {
    if (!active) return;
    saveMemo(active.seed, { resolution: active.resolution, generated: active.generated, saved: active.saved, needsRefresh: active.needsRefresh });
    updateBadges();
  };
  const stopPreviewPoll = () => { if (previewTimer) window.clearTimeout(previewTimer); previewTimer = undefined; };

  const current = (expected: number) => active?.token === expected && host.isConnected;
  const minimumHeight = () => Math.min(window.innerHeight, Math.max(360,
    (root.querySelector('.head')?.getBoundingClientRect().height ?? 0)
    + (root.querySelector('.footer')?.getBoundingClientRect().height ?? 0) + 96));
  const positionPanel = () => {
    const viewportHeight = Math.max(0, window.innerHeight);
    if (panel.fullHeight) panel = { top: 0, height: viewportHeight, fullHeight: true };
    else {
      panel.height = Math.min(viewportHeight, Math.max(minimumHeight(), panel.height));
      panel.top = Math.max(0, Math.min(panel.top, viewportHeight - panel.height));
    }
    host.style.right = '0px'; host.style.left = 'auto';
    host.style.width = `${Math.min(420, Math.max(0, window.innerWidth))}px`;
    host.style.top = `${panel.top}px`; host.style.height = `${panel.height}px`;
    for (const edge of root.querySelectorAll<HTMLElement>('.resize-handle')) {
      edge.setAttribute('aria-valuemin', String(Math.round(minimumHeight())));
      edge.setAttribute('aria-valuemax', String(Math.round(viewportHeight)));
      edge.setAttribute('aria-valuenow', String(Math.round(panel.height)));
    }
  };
  const pinPanel = () => {
    if (!active) return;
    active.pinned = true;
    if (hoverTimer) window.clearTimeout(hoverTimer);
    const pin = root.querySelector<HTMLButtonElement>('[data-action="pin"]');
    if (pin) { pin.textContent = label('unpin'); pin.setAttribute('aria-pressed', 'true'); }
    if (active.notice?.key === 'unpinned') {
      active.notice = { key: 'pinned', failure: false };
      const status = root.querySelector<HTMLElement>('.status');
      if (status && !active.generationPending) status.textContent = label('pinned');
    }
  };
  const finishResize = () => {
    if (resizing) { try { host.releasePointerCapture?.(resizing.pointerId); } catch { /* Pointer already released. */ } }
    resizing = undefined;
    delete host.dataset.resizing;
  };
  const close = (restoreFocus = false) => {
    const prior = active;
    stopPreviewPoll();
    active = undefined;
    finishResize();
    token += 1;
    if (hoverTimer) window.clearTimeout(hoverTimer);
    hoverTimer = undefined;
    host.style.display = 'none';
    root.replaceChildren();
    if (restoreFocus && prior?.keyboard) {
      suppressFocusTarget = prior.element;
      (prior.element.querySelector('a') ?? prior.element.querySelector(TITLE_SELECTOR) as HTMLElement | null)?.focus?.();
    }
  };

  const render = (notice?: ContentMessageKey, failure = false, detail?: string) => {
    if (!active) return;
    if (notice) active.notice = { key: notice, failure, detail };
    host.lang = preferences.uiLanguage;
    const previousDetailsOpen = root.querySelector<HTMLDetailsElement>('details')?.open ?? false;
    const previousScrollTop = root.querySelector<HTMLElement>('.body')?.scrollTop ?? 0;
    const activeElement = root.activeElement;
    const focused: CardFocus | undefined = activeElement instanceof HTMLButtonElement && activeElement.dataset.action
      ? { kind: 'button', action: activeElement.dataset.action, candidateId: activeElement.dataset.candidateId }
      : activeElement instanceof HTMLElement && activeElement.tagName === 'SUMMARY'
        ? { kind: 'summary' }
        : activeElement instanceof HTMLElement && activeElement.dataset.edge
          ? { kind: 'edge', edge: activeElement.dataset.edge }
        : activeElement instanceof HTMLElement && activeElement.classList.contains('body')
          ? { kind: 'body' }
        : activeElement instanceof HTMLAnchorElement
          ? { kind: 'link', href: activeElement.href, className: activeElement.className }
          : undefined;
    root.replaceChildren();
    addStyle(root);
    const card = document.createElement('section');
    card.className = 'card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'false');
    card.setAttribute('aria-labelledby', 'scholar-hover-heading');
    card.setAttribute('aria-busy', String(!!active.generationPending || !!active.savePending || !!active.metadataPending));
    const head = document.createElement('div'); head.className = 'head';
    const heading = document.createElement('h2'); heading.id = 'scholar-hover-heading'; heading.textContent = active.paper?.title || active.seed.title;
    const titleGroup = document.createElement('div'); titleGroup.className = 'title-group';
    titleGroup.append(heading); text(titleGroup, label('resizeHint'), 'resize-hint'); head.append(titleGroup);
    const actions = document.createElement('div'); actions.className = 'actions';
    actions.append(cardButton(label(active.pinned ? 'unpin' : 'pin'), 'pin', active.pinned), cardButton(label('fullHeight'), 'reset-height'), cardButton(label('close'), 'close'));
    head.append(actions); card.append(head);
    const body = document.createElement('div'); body.className = 'body'; body.tabIndex = 0;
    body.setAttribute('aria-label', label('contents'));
    const metadata = [(active.paper?.authors ?? active.seed.authors).join(', '), active.paper?.year ?? active.seed.year ? String(active.paper?.year ?? active.seed.year) : '', active.paper?.venue ?? active.seed.venue ?? ''].filter(Boolean).join(' · ');
    if (metadata) { const p = document.createElement('p'); p.className = 'meta'; p.textContent = metadata; body.append(p); }
    if (active.generated?.titleTranslated) { const p = document.createElement('p'); p.className = 'translated'; p.lang = active.generated.language; p.textContent = active.generated.titleTranslated; body.append(p); }
    const status = document.createElement('p'); status.className = `status${active.notice?.failure ? ' failure' : ''}`; status.setAttribute('role', 'status'); status.textContent = active.metadataPending ? label(active.paper ? 'readingAbstract' : 'resolving') : active.generationPending ? label('generating') : active.notice?.detail ? localizeError(active.notice.detail, preferences.uiLanguage) : label(active.notice?.key ?? (active.paper ? 'matched' : 'resolving'));
    if (active.resolution?.warning) { const warning = document.createElement('p'); warning.className = 'warning'; warning.textContent = localizeError(active.resolution.warning, preferences.uiLanguage); body.append(warning); }
    if (active.resolution?.cacheWarning) { const warning = document.createElement('p'); warning.className = 'warning cache-warning'; warning.textContent = localizeError(active.resolution.cacheWarning, preferences.uiLanguage); body.append(warning); }
    if (active.resolution?.candidates.length && active.paper?.matchStatus === 'unresolved' && !active.saved) {
      const section = document.createElement('div'); section.className = 'section';
      text(section, label('chooseMatch'), 'label');
      for (const candidate of active.resolution.candidates) {
        const button = cardButton(candidate.title, 'confirm'); button.className = 'candidate'; button.dataset.candidateId = candidate.id;
        const detail = document.createElement('small'); detail.textContent = [candidate.authors.join(', '), candidate.year ? String(candidate.year) : '', candidate.venue ?? ''].filter(Boolean).join(' · '); button.append(detail); section.append(button);
      }
      body.append(section);
    }
    if (active.paper) {
      const section = document.createElement('div'); section.className = 'section';
      text(section, label('abstract'), 'label');
      if (!active.paper.abstract) text(section, label('noAbstract'));
      else {
        const details = document.createElement('details');
        const summary = document.createElement('summary'); summary.textContent = label('expandAbstract'); details.append(summary);
        const original = document.createElement('p'); original.textContent = active.paper.abstract; details.append(original);
        if (active.generated?.abstractTranslated) { const translation = document.createElement('p'); translation.textContent = active.generated.abstractTranslated; translation.lang = active.generated.language; details.append(translation); }
        section.append(details);
      }
      if (active.paper.abstract && active.generated?.summary) { const summarySection = document.createElement('div'); summarySection.className = 'section'; text(summarySection, label('summary'), 'label'); text(summarySection, active.generated.summary).lang = active.generated.language; body.append(summarySection); }
      body.append(section);
      appendSource(body, active.paper, label, active.generated);
    }
    const footer = document.createElement('div'); footer.className = 'footer';
    footer.append(status);
    const footerActions = document.createElement('div'); footerActions.className = 'footer-actions';
    if (active.seed.url && isSafeUrl(active.seed.url)) { const original = document.createElement('a'); original.className = 'original'; original.href = active.seed.url; original.target = '_blank'; original.rel = 'noopener noreferrer'; original.textContent = label('openOriginal'); footerActions.append(original); }
    if (active.paper) footerActions.append(cardButton(label('copy'), 'copy'));
    if (active.resolution && !active.paper?.abstract) {
      const retry = cardButton(label(active.metadataPending ? 'readingAbstract' : 'retryMetadata'), 'retry-metadata');
      retry.disabled = !!active.metadataPending || !!active.savePending || !!completionPending(active.saved);
      footerActions.append(retry);
    }
    if (active.resolution?.sourceAccess) {
      const access = cardButton(label('sourceAccess'), 'source-access');
      access.disabled = !!active.sourceAccessPending || !!active.metadataPending;
      footerActions.append(access);
    }
    if (active.paper && !active.generated) {
      const generating = !!active.generationPending || !!completionPending(active.saved);
      const generate = cardButton(label(generating ? 'generating' : failedGenerationAttempts.has(generationAttempt(active.paper)) ? 'retryGenerate' : 'generate'), 'generate');
      generate.disabled = generating || !!active.metadataPending; footerActions.append(generate);
    }
    footerActions.append(cardButton(label('settings'), 'settings'));
    footer.append(footerActions);
    const collectionActions = document.createElement('div'); collectionActions.className = 'collection-actions';
    const savingNow = !!active.savePending || saving.has(seedKey(active.seed));
    const saved = !!active.saved;
    const save = cardButton(label(savingNow ? 'saving' : saved ? 'savedButton' : 'save'), 'save');
    save.disabled = savingNow;
    const collection = cardButton(label(active.collectionPending ? 'collectionOpening' : 'collection'), 'collection');
    collection.disabled = !!active.collectionPending;
    collectionActions.append(save, collection); footer.append(collectionActions);
    if (active.saveNotice || active.saved?.completion) {
      const saveStatus = document.createElement('p'); saveStatus.className = `status save-status${active.saveNotice?.failure ? ' failure' : ''}`;
      saveStatus.setAttribute('role', 'status');
      saveStatus.textContent = active.saveNotice?.failure ? active.saveNotice.detail ? localizeError(active.saveNotice.detail, preferences.uiLanguage) : label(active.saveNotice.key)
        : active.saved?.completion ? label(completionLabels[active.saved.completion.status])
        : active.saveNotice ? active.saveNotice.detail ? localizeError(active.saveNotice.detail, preferences.uiLanguage) : label(active.saveNotice.key) : '';
      if (active.saved?.completion?.error && !active.saveNotice?.failure) saveStatus.append(document.createTextNode(` ${localizeError(active.saved.completion.error, preferences.uiLanguage)}`));
      footer.append(saveStatus);
    }
    card.append(body, footer); root.append(card);
    for (const edge of ['top', 'bottom'] as const) {
      const handle = document.createElement('div'); handle.className = 'resize-handle'; handle.dataset.edge = edge; handle.tabIndex = 0;
      handle.setAttribute('role', 'separator'); handle.setAttribute('aria-orientation', 'horizontal');
      handle.setAttribute('aria-label', label(edge === 'top' ? 'resizeTop' : 'resizeBottom'));
      root.append(handle);
    }
    positionPanel();
    host.dataset.paperId = active.paper?.id ?? '';
    host.dataset.saved = String(!!active.saved);
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button[data-action]'));
    const details = root.querySelector<HTMLDetailsElement>('details');
    if (details && previousDetailsOpen) details.open = true;
    body.scrollTop = previousScrollTop;
    if (focused) {
      const restored = focused.kind === 'button'
        ? buttons.find(button => !button.disabled && button.dataset.action === focused.action && button.dataset.candidateId === focused.candidateId)
          ?? (focused.action === 'confirm' ? buttons.find(button => button.dataset.action === 'confirm') : undefined)
        : focused.kind === 'summary'
          ? root.querySelector<HTMLElement>('details > summary')
          : focused.kind === 'edge' ? root.querySelector<HTMLElement>(`.resize-handle[data-edge="${focused.edge}"]`)
          : focused.kind === 'body' ? body
          : Array.from(root.querySelectorAll<HTMLAnchorElement>('a')).find(link => link.href === focused.href && link.className === focused.className);
      (restored ?? buttons.find(button => button.dataset.action === 'close'))?.focus();
    } else if (active.focusPending) { active.focusPending = false; buttons.find(button => button.dataset.action === 'close')?.focus(); }
    // Keyboard focus restoration can scroll an ancestor; retain the reading position.
    body.scrollTop = previousScrollTop;
    rememberActive();
  };

  const generationCurrent = (expected: number, paper: Paper, revision: number) => current(expected) && active?.paper?.id === paper.id && configRevision === revision;
  // Keeping the dock visible must not authorize a new model call after the
  // reader has left the result. Cached data can still finish loading normally.
  const interestedInActive = () => !!active && (active.pinned || active.titleHovered || active.cardHovered
    || !!root.activeElement || resultFor(document.activeElement) === active.element);
  const showGeneration = async (expected: number, paper: Paper, force = false) => {
    const revision = configRevision;
    const attempt = generationAttempt(paper);
    const pending = `${revision}:${paper.id}`;
    if (!generationCurrent(expected, paper, revision) || !active || active.metadataPending || active.generationPending === pending || failedGenerationAttempts.has(attempt) && !force) return;
    active.generationPending = pending;
    render('generating');
    try {
      const generated = await rpc<Generated>({ type: 'GENERATE', paperId: paper.id, ...(force ? { force: true } : {}) });
      if (!generationCurrent(expected, paper, revision) || !active) return;
      active.generationPending = undefined;
      if (!validGenerated(generated)) { render('outputChanged', true); settingsReady = refreshSettings(); return; }
      failedGenerationAttempts.delete(attempt);
      active.generated = generated;
      if (generated.collectionWarning) active.saveNotice = { key: 'saveFailed', failure: true, detail: generated.collectionWarning };
      render(generated.cacheWarning ? 'cachedWarning' : 'generated', !!generated.cacheWarning, generated.cacheWarning);
    } catch (error) {
      if (!generationCurrent(expected, paper, revision)) return;
      active!.generationPending = undefined;
      failedGenerationAttempts.add(attempt);
      render('generationFailed', true, error instanceof Error ? error.message : undefined);
    } finally {
      if (current(expected) && active?.generationPending === pending) active.generationPending = undefined;
    }
  };

  const loadOutput = async (expected: number, paper: Paper, resumeGeneration = false) => {
    await settingsReady;
    const revision = configRevision;
    const pending = `${revision}:${paper.id}`;
    if (!generationCurrent(expected, paper, revision) || !active || active.outputPending === pending) return;
    active.outputPending = pending;
    try {
      const cached = await rpc<Generated | undefined>({ type: 'GET_CACHED', paperId: paper.id });
      if (!generationCurrent(expected, paper, revision) || !active) return;
      if (validGenerated(cached)) { active.generated = cached; render('cached'); return; }
      if (!active.saved && !active.savePending && preferences.hasApiKey && preferences.consent && (resumeGeneration || preferences.autoGenerate && interestedInActive())) await showGeneration(expected, paper, resumeGeneration);
    } catch { /* The matched paper remains usable without a cache. */ }
    finally {
      if (current(expected) && active?.outputPending === pending) active.outputPending = undefined;
    }
  };

  const resumeAutomaticGeneration = () => {
    if (active?.paper && !active.saved && !active.savePending && !active.previewPending && !active.metadataPending && active.paper.matchStatus !== 'unresolved' && !active.generated && !active.generationPending
      && !active.outputPending && preferences.autoGenerate && interestedInActive()) void loadOutput(active.token, active.paper);
  };

  const language = (value: unknown): Language => LANGUAGES.includes(value as Language) ? value as Language : 'zh-CN';
  const refreshSettings = async () => {
    const read = ++settingsRead;
    try {
      const settings = await rpc<SettingsView>({ type: 'GET_SETTINGS' });
      if (stopped || read !== settingsRead) return;
      const next = { ...settings, uiLanguage: language(settings.uiLanguage), outputLanguage: language(settings.outputLanguage) };
      const uiChanged = next.uiLanguage !== preferences.uiLanguage;
      const outputChanged = next.outputLanguage !== preferences.outputLanguage || next.baseUrl !== preferences.baseUrl || next.model !== preferences.model;
      preferences = next;
      updateBadges();
      if (outputChanged) configRevision += 1;
      if (!active) return;
      if (outputChanged) {
        const resumeGeneration = !!active.generationPending;
        active.generated = undefined;
        active.generationPending = undefined;
        active.outputPending = undefined;
        active.previewPending = false;
        active.previewRead = ++previewRead;
        render(active.resolution ? resolutionNotice(active.resolution) : active.paper ? 'matched' : 'resolving');
        if (!active.paper) void refreshPreview(active.token, active.seed, undefined, true);
        else if (active.saved) void refreshPreview(active.token, active.seed);
        else if (active.paper && active.paper.matchStatus !== 'unresolved') void loadOutput(active.token, active.paper, resumeGeneration);
      } else if (uiChanged) render();
    } catch { /* Keep the last known language if settings cannot be read. */ }
  };

  const applySnapshot = (snapshot: PreviewSnapshot) => {
    if (!active) return false;
    const before = JSON.stringify([active.resolution, active.generated, active.saved]);
    const resolution = snapshot.resolution ?? (snapshot.saved ? { paper: snapshot.saved.paper, candidates: snapshot.saved.candidates ?? [] } : undefined);
    if (active.saved && !snapshot.saved && !active.savePending && !active.saveNotice?.failure) active.saveNotice = undefined;
    active.saved = snapshot.saved;
    active.needsRefresh = snapshot.needsRefresh;
    active.savedPaperId = snapshot.saved?.id;
    if (resolution) { active.resolution = resolution; active.paper = resolution.paper; }
    active.generated = validGenerated(snapshot.generated);
    if (active.generated) active.notice = { key: 'cached', failure: false };
    else if (resolution) active.notice = { key: resolutionNotice(resolution), failure: resolutionNotice(resolution) === 'queryFailed' };
    if (snapshot.saved && !active.saveNotice?.failure) active.saveNotice = { key: 'saved', failure: false };
    return before !== JSON.stringify([active.resolution, active.generated, active.saved]);
  };
  const fetchPreview = async (seed: PaperSeed): Promise<PreviewRead> => {
    await settingsReady;
    const config = configuration(), source = seedKey(seed), epoch = seedEpoch.get(source) ?? 0;
    const key = JSON.stringify([source, config, epoch]);
    const pending = previews.get(key); if (pending) return pending;
    const request = rpc<PreviewSnapshot | undefined>({ type: 'GET_PREVIEW', seed }).then(value => {
      const snapshot: PreviewSnapshot = value && (value.resolution || value.saved || value.generated) ? value : {};
      if (!stopped && (seedEpoch.get(source) ?? 0) === epoch) {
        saveMemo(seed, snapshot, config); updateBadges();
      }
      return { snapshot, configuration: config, epoch };
    }).catch(error => ({ snapshot: {}, configuration: config, epoch, failed: true, error: error instanceof Error ? error.message : undefined }));
    previews.set(key, request);
    try { return await request; } finally { if (previews.get(key) === request) previews.delete(key); }
  };
  const schedulePreviewPoll = () => {
    stopPreviewPoll();
    if (active && !stopped && completionPending(active.saved)) {
      const expected = active.token, seed = active.seed;
      previewTimer = window.setTimeout(() => { void refreshPreview(expected, seed); }, 1000);
    }
  };
  const refreshPreview = async (expected: number, seed: PaperSeed, request = fetchPreview(seed), initial = false) => {
    if (!current(expected) || !active) return;
    const read = ++previewRead, revision = configRevision;
    active.previewRead = read; active.previewPending = true;
    const result = await request;
    if (!current(expected) || !active || active.previewRead !== read || revision !== configRevision) return;
    active.previewPending = false;
    if (result.epoch !== (seedEpoch.get(seedKey(seed)) ?? 0)) {
      // Saving may finish while this result is still in the 500 ms dwell period.
      // Its prefetched snapshot predates that save even though the card is new.
      void refreshPreview(expected, seed, fetchPreview(seed), initial);
      return;
    }
    if (result.failed) {
      stopPreviewPoll();
      render('previewFailed', true, result.error);
      return;
    }
    const snapshot = result.configuration === configuration() ? result.snapshot : { ...result.snapshot, generated: undefined };
    const changed = applySnapshot(snapshot);
    if (changed) render();
    schedulePreviewPoll();
    if (active.saved || active.savePending) return;
    if (initial && (!snapshot.resolution || snapshot.needsRefresh && !active.paper?.abstract && !active.generated?.abstractTranslated && !active.generated?.summary)) void enrich(expected, seed);
    else if (!active.generated && active.paper && active.paper.matchStatus !== 'unresolved') void loadOutput(expected, active.paper);
  };
  const enrich = async (expected: number, seed: PaperSeed, retry = false) => {
    if (!current(expected) || !active || active.metadataPending || active.savePending || completionPending(active.saved) || !retry && active.metadataAttempted) return;
    const epoch = seedEpoch.get(seedKey(seed)) ?? 0;
    active.metadataPending = true; active.metadataAttempted = true;
    render();
    try {
      const resolution = await rpc<Resolution>({ type: 'RESOLVE', seed, ...(retry ? { retry: true } : {}) });
      if (!current(expected) || !active || active.savePending || (seedEpoch.get(seedKey(seed)) ?? 0) !== epoch || active.saved && !retry) return;
      const outputChanged = active.paper && outputIdentity(active.paper) !== outputIdentity(resolution.paper);
      if (outputChanged) {
        configRevision += 1;
        active.generated = undefined; active.outputPending = undefined; active.generationPending = undefined;
      }
      active.metadataPending = false; active.needsRefresh = false;
      active.resolution = resolution;
      active.paper = resolution.paper;
      const notice = resolutionNotice(resolution);
      render(notice, notice === 'queryFailed');
      if (active.saved) { void refreshPreview(expected, seed); return; }
      if (resolution.paper.matchStatus === 'unresolved') return;
      if (!active.generated) void loadOutput(expected, resolution.paper, false);
    } catch (error) {
      if (current(expected) && active) { active.metadataPending = false; render('queryFailed', true, error instanceof Error ? error.message : undefined); }
    } finally {
      if (current(expected) && active?.metadataPending) { active.metadataPending = false; render(); }
    }
  };

  const open = (element: Element, keyboard = false, preview?: Promise<PreviewRead>) => {
    if (active?.pinned && active.element !== element) return;
    const seed = parseResult(element); if (!seed) return;
    if (active?.element === element) { resumeAutomaticGeneration(); return; }
    if (hoverTimer) window.clearTimeout(hoverTimer);
    stopPreviewPoll();
    const expected = ++token;
    active = { element, seed, token: expected, pinned: false, titleHovered: !keyboard, cardHovered: false, keyboard, focusPending: keyboard, previewPending: true, ...(saving.has(seedKey(seed)) ? { savePending: seedKey(seed) } : {}) };
    viewed.add(seedKey(seed));
    const existing = memoSnapshot(seed); if (existing) applySnapshot(existing);
    host.style.display = 'block'; positionPanel(); render();
    void refreshPreview(expected, seed, preview ?? fetchPreview(seed), true);
  };
  const scheduleOpen = (element: Element, keyboard = false) => {
    if (active?.pinned && active.element !== element) return;
    if (hoverTimer) window.clearTimeout(hoverTimer);
    const seed = parseResult(element);
    const preview = seed ? fetchPreview(seed) : undefined;
    hoverTimer = window.setTimeout(() => open(element, keyboard, preview), HOVER_DELAY);
  };
  const onOver = (event: MouseEvent) => {
    const element = resultFor(event.target);
    if (!element) return;
    if (active?.element === element) { active.titleHovered = true; resumeAutomaticGeneration(); }
    else scheduleOpen(element);
  };
  // A right-docked panel must remain reachable across the space between the
  // result title and the page edge. Leaving a title defers new automatic calls.
  const onOut = (event: MouseEvent) => {
    const element = resultFor(event.target);
    if (!element || resultFor(event.relatedTarget) === element) return;
    if (hoverTimer) window.clearTimeout(hoverTimer);
    hoverTimer = undefined;
    if (active?.element === element) active.titleHovered = false;
  };
  const onHostOver = () => { if (active && !active.cardHovered) { active.cardHovered = true; resumeAutomaticGeneration(); } };
  const onHostOut = (event: MouseEvent) => {
    if (active && !(event.relatedTarget instanceof Node && (host.contains(event.relatedTarget) || root.contains(event.relatedTarget)))) active.cardHovered = false;
  };
  const onHostFocus = () => { resumeAutomaticGeneration(); };
  const onFocus = (event: FocusEvent) => { const element = resultFor(event.target); if (element) { if (element === suppressFocusTarget) { suppressFocusTarget = undefined; return; } scheduleOpen(element, true); } };
  const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && active) { event.preventDefault(); close(true); } };
  const onPointerDown = (event: PointerEvent) => { if (active && !active.pinned && !event.composedPath().includes(host) && !active.element.contains(event.target as Node)) close(); };
  const onCardClick = (event: Event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]'); if (!button || !active) return;
    const expected = active.token;
    if (button.dataset.action === 'close') { close(true); return; }
    if (button.dataset.action === 'pin') { active.pinned = !active.pinned; render(active.pinned ? 'pinned' : 'unpinned'); resumeAutomaticGeneration(); return; }
    if (button.disabled) return;
    if (button.dataset.action === 'reset-height') { panel.fullHeight = true; positionPanel(); return; }
    if (button.dataset.action === 'save') {
      const seed = active.seed, key = seedKey(seed), paperId = active.paper?.id;
      if (saving.has(key)) return;
      seedEpoch.set(key, (seedEpoch.get(key) ?? 0) + 1);
      active.previewRead = ++previewRead; active.previewPending = false;
      active.savePending = key; active.saveNotice = { key: 'saving', failure: false };
      const request = rpc<SavedPaper>({ type: 'SAVE_PAPER', seed, ...(paperId ? { paperId } : {}) });
      saving.set(key, request); render();
      void request.then(saved => {
        saving.delete(key);
        seedEpoch.set(key, (seedEpoch.get(key) ?? 0) + 1);
        const prior = memoSnapshot(seed) ?? {};
        const resolution = prior.resolution ?? { paper: saved.paper, candidates: saved.candidates ?? [] };
        saveMemo(seed, { ...prior, resolution, saved }); updateBadges();
        if (!active || seedKey(active.seed) !== key || stopped) return;
        active.previewRead = ++previewRead; active.previewPending = false;
        active.savePending = undefined; active.savedPaperId = saved.id; active.saved = saved;
        if (!active.paper) { active.paper = resolution.paper; active.resolution = resolution; }
        active.saveNotice = { key: saved.paper.matchStatus === 'unresolved' ? 'savedUnresolved' : 'saved', failure: false }; render();
        schedulePreviewPoll();
      }).catch(error => {
        saving.delete(key);
        if (!active || seedKey(active.seed) !== key || stopped) return;
        active.savePending = undefined;
        active.saveNotice = { key: 'saveFailed', failure: true, detail: error instanceof Error ? error.message : undefined }; render();
      }); return;
    }
    if (button.dataset.action === 'collection') {
      if (active.collectionPending) return;
      active.collectionPending = true; render();
      void rpc<void>({ type: 'OPEN_COLLECTION' }).then(() => {
        if (!current(expected) || !active) return;
        active.collectionPending = false; render('collectionOpened');
      }).catch(error => {
        if (!current(expected) || !active) return;
        active.collectionPending = false; render('collectionFailed', true, error instanceof Error ? error.message : undefined);
      }); return;
    }
    if (button.dataset.action === 'settings') { void rpc<void>({ type: 'OPEN_SETTINGS' }).catch(() => render('settingsFailed', true)); return; }
    if (button.dataset.action === 'retry-metadata') { void enrich(expected, active.seed, true); return; }
    if (button.dataset.action === 'source-access' && active.resolution?.sourceAccess) {
      active.sourceAccessPending = true; render();
      void rpc<void>({ type: 'OPEN_SOURCE_ACCESS', seed: active.seed }).then(() => {
        if (!current(expected) || !active) return;
        active.sourceAccessPending = false; active.sourceAccessReturn = true; render('sourceAccessOpened');
      }).catch(error => {
        if (!current(expected) || !active) return;
        active.sourceAccessPending = false; render('sourceAccessFailed', true, error instanceof Error ? error.message : undefined);
      }); return;
    }
    if (button.dataset.action === 'generate' && active.paper) {
      pinPanel();
      void showGeneration(expected, active.paper, true); return;
    }
    if (button.dataset.action === 'copy' && active.paper) {
      const payload = [active.generated?.titleTranslated || active.paper.title, active.seed.authors.join(', '), active.seed.year ? String(active.seed.year) : '', active.seed.url].filter(Boolean).join('\n');
      if (!navigator.clipboard?.writeText) { render('copyUnavailable', true); return; }
      void navigator.clipboard.writeText(payload).then(() => current(expected) && render('copied')).catch(() => current(expected) && render('copyFailed', true)); return;
    }
    if (button.dataset.action === 'confirm' && button.dataset.candidateId) {
      const seed = active.seed;
      render('confirming');
      void rpc<Resolution>({ type: 'CONFIRM', candidateId: button.dataset.candidateId, seed }).then(resolution => {
        if (!current(expected) || !active) return;
        active.resolution = resolution; active.paper = resolution.paper; active.generated = undefined;
        active.savePending = undefined; active.savedPaperId = undefined; active.saveNotice = undefined; render('confirmed');
        void loadOutput(expected, resolution.paper);
      }).catch(error => current(expected) && render('confirmFailed', true, error instanceof Error ? error.message : undefined));
    }
  };
  const resizeEdge = (edge: 'top' | 'bottom', change: number, from = panel) => {
    panel.fullHeight = false;
    const bottom = from.top + from.height;
    if (edge === 'top') {
      panel.top = Math.max(0, Math.min(from.top + change, bottom - minimumHeight()));
      panel.height = bottom - panel.top;
    } else panel.height = Math.max(minimumHeight(), Math.min(from.height + change, window.innerHeight - from.top));
    pinPanel(); positionPanel();
  };
  const onResizeStart = (event: PointerEvent) => {
    const target = event.target;
    if (!active || event.button !== 0 || !(target instanceof Element)) return;
    const edge = target.closest<HTMLElement>('.resize-handle')?.dataset.edge;
    if (edge !== 'top' && edge !== 'bottom') return;
    resizing = { pointerId: event.pointerId, edge, y: event.clientY, top: panel.top, height: panel.height };
    pinPanel(); host.dataset.resizing = 'true';
    try { host.setPointerCapture?.(event.pointerId); } catch { /* Synthetic pointer events do not support capture. */ }
    event.preventDefault();
  };
  const onResizeMove = (event: PointerEvent) => {
    if (!resizing || !active || event.pointerId !== resizing.pointerId) return;
    resizeEdge(resizing.edge, event.clientY - resizing.y, { ...resizing, fullHeight: false });
    event.preventDefault();
  };
  const onResizeEnd = (event: PointerEvent) => { if (resizing?.pointerId === event.pointerId) finishResize(); };
  const onResizeKey = (event: KeyboardEvent) => {
    const edge = event.target instanceof HTMLElement ? event.target.dataset.edge : undefined;
    if (!active || (edge !== 'top' && edge !== 'bottom')) return;
    if (event.key === 'End') { panel.fullHeight = true; positionPanel(); event.preventDefault(); }
    else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      resizeEdge(edge, (event.key === 'ArrowUp' ? -1 : 1) * (event.shiftKey ? 64 : 24)); event.preventDefault();
    }
  };
  const onResize = () => { if (active) positionPanel(); };
  const onWindowFocus = () => {
    requestBadgeStates(true); settingsReady = refreshSettings();
    void settingsReady.then(() => {
      if (active?.sourceAccessReturn) { active.sourceAccessReturn = false; void enrich(active.token, active.seed, true); }
      else if (active?.saved) void refreshPreview(active.token, active.seed);
    });
  };
  settingsReady = refreshSettings();
  window.addEventListener('focus', onWindowFocus);
  window.addEventListener('resize', onResize);
  root.addEventListener('pointerdown', onResizeStart as EventListener);
  root.addEventListener('keydown', onResizeKey as EventListener);
  document.addEventListener('pointermove', onResizeMove, true);
  document.addEventListener('pointerup', onResizeEnd, true);
  document.addEventListener('pointercancel', onResizeEnd, true);
  document.addEventListener('mouseover', onOver, true); document.addEventListener('mouseout', onOut, true); document.addEventListener('focusin', onFocus, true); document.addEventListener('keydown', onKey, true); document.addEventListener('pointerdown', onPointerDown, true);
  host.addEventListener('mouseover', onHostOver); host.addEventListener('mouseout', onHostOut); root.addEventListener('focusin', onHostFocus);
  root.addEventListener('click', onCardClick);
  const observer = new MutationObserver(() => { if (active && !active.element.isConnected && !active.pinned) close(); updateBadges(); requestBadgeStates(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  updateBadges();
  requestBadgeStates();
  return () => { stopped = true; close(); observer.disconnect(); window.removeEventListener('focus', onWindowFocus); window.removeEventListener('resize', onResize); document.removeEventListener('pointermove', onResizeMove, true); document.removeEventListener('pointerup', onResizeEnd, true); document.removeEventListener('pointercancel', onResizeEnd, true); document.removeEventListener('mouseover', onOver, true); document.removeEventListener('mouseout', onOut, true); document.removeEventListener('focusin', onFocus, true); document.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onPointerDown, true); document.querySelectorAll('[data-scholar-hover-badge]').forEach(badge => badge.remove()); document.querySelectorAll<HTMLElement>('[data-scholar-hover-state]').forEach(result => { delete result.dataset.scholarHoverState; }); host.remove(); };
}

if (typeof chrome !== 'undefined' && chrome.runtime?.id && typeof document !== 'undefined') startContentScript();
