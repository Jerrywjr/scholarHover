import { HOVER_DELAY } from '../shared/defaults.ts';
import { rpc } from '../shared/rpc.ts';
import { localizeError } from '../shared/errors.ts';
import { LANGUAGES, type Language } from '../shared/languages.ts';
import { contentText, type ContentMessageKey } from './messages.ts';
import type { Generated, Paper, PaperSeed, Resolution, SavedPaper, SettingsView } from '../shared/types.ts';

const RESULT_SELECTOR = '.gs_r.gs_or.gs_scl';
const TITLE_SELECTOR = '.gs_rt';
const CARD_ID = 'scholar-hover-card';

type Active = {
  element: Element;
  seed: PaperSeed;
  token: number;
  pinned: boolean;
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
  saveNotice?: { key: ContentMessageKey; failure: boolean; detail?: string };
  collectionPending?: boolean;
};

type CardFocus =
  | { kind: 'button'; action: string; candidateId?: string }
  | { kind: 'summary' }
  | { kind: 'body' }
  | { kind: 'edge'; edge: string }
  | { kind: 'link'; href: string; className: string };

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
  const names = [`${label('source')}: ${paper.source}`];
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
    const name = source.name === 'Crossref · 摘要' ? label('crossrefAbstract') : source.name;
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
  let preferences: SettingsView = { uiLanguage: 'zh-CN', outputLanguage: 'zh-CN', baseUrl: '', model: '', autoGenerate: false, consent: false, rememberKey: false, hasApiKey: false, hasOpenAlexKey: false };
  let configRevision = 0;
  let settingsRead = 0;
  let stopped = false;
  let settingsReady: Promise<void>;
  const label = (key: ContentMessageKey) => contentText(key, preferences.uiLanguage, preferences.outputLanguage);

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
    card.setAttribute('aria-busy', String(!!active.generationPending || !!active.savePending));
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
    const status = document.createElement('p'); status.className = `status${active.notice?.failure ? ' failure' : ''}`; status.setAttribute('role', 'status'); status.textContent = active.generationPending ? label('generating') : active.notice?.detail ? localizeError(active.notice.detail, preferences.uiLanguage) : label(active.notice?.key ?? (active.paper ? 'matched' : 'resolving'));
    if (active.resolution?.warning) { const warning = document.createElement('p'); warning.className = 'warning'; warning.textContent = localizeError(active.resolution.warning, preferences.uiLanguage); body.append(warning); }
    if (active.resolution?.candidates.length && active.paper?.matchStatus === 'unresolved') {
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
    if (active.paper && !active.generated) {
      const generating = !!active.generationPending;
      const generate = cardButton(label(generating ? 'generating' : active.notice?.failure ? 'retryGenerate' : 'generate'), 'generate');
      generate.disabled = generating; footerActions.append(generate);
    }
    footerActions.append(cardButton(label('settings'), 'settings'));
    footer.append(footerActions);
    const collectionActions = document.createElement('div'); collectionActions.className = 'collection-actions';
    const saving = !!active.paper && active.savePending === active.paper.id;
    const saved = !!active.paper && active.savedPaperId === active.paper.id;
    const save = cardButton(label(saving ? 'saving' : saved ? 'savedButton' : 'save'), 'save');
    save.disabled = !active.paper || saving;
    const collection = cardButton(label(active.collectionPending ? 'collectionOpening' : 'collection'), 'collection');
    collection.disabled = !!active.collectionPending;
    collectionActions.append(save, collection); footer.append(collectionActions);
    if (active.saveNotice) {
      const saveStatus = document.createElement('p'); saveStatus.className = `status save-status${active.saveNotice.failure ? ' failure' : ''}`;
      saveStatus.setAttribute('role', 'status');
      saveStatus.textContent = active.saveNotice.detail ? localizeError(active.saveNotice.detail, preferences.uiLanguage) : label(active.saveNotice.key);
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
  };

  const generationCurrent = (expected: number, paper: Paper, revision: number) => current(expected) && active?.paper?.id === paper.id && configRevision === revision;
  const showGeneration = async (expected: number, paper: Paper, force = false) => {
    const revision = configRevision;
    const attempt = JSON.stringify([paper.id, preferences.outputLanguage, preferences.baseUrl, preferences.model]);
    const pending = `${revision}:${paper.id}`;
    if (!generationCurrent(expected, paper, revision) || !active || active.generationPending === pending || failedGenerationAttempts.has(attempt) && !force) return;
    active.generationPending = pending;
    render('generating');
    try {
      const generated = await rpc<Generated>({ type: 'GENERATE', paperId: paper.id, ...(force ? { force: true } : {}) });
      if (!generationCurrent(expected, paper, revision) || !active) return;
      active.generationPending = undefined;
      if (generated.language !== preferences.outputLanguage) { render('outputChanged', true); settingsReady = refreshSettings(); return; }
      failedGenerationAttempts.delete(attempt);
      active.generated = generated;
      if (generated.collectionWarning) active.saveNotice = { key: 'saveFailed', failure: true, detail: generated.collectionWarning };
      render('generated');
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
      if (cached?.language === preferences.outputLanguage) { active.generated = cached; render('cached'); return; }
      if (preferences.hasApiKey && preferences.consent && (preferences.autoGenerate || resumeGeneration)) await showGeneration(expected, paper, resumeGeneration);
    } catch { /* The matched paper remains usable without a cache. */ }
    finally {
      if (current(expected) && active?.outputPending === pending) active.outputPending = undefined;
    }
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
      if (outputChanged) configRevision += 1;
      if (!active) return;
      if (outputChanged) {
        const resumeGeneration = !!active.generationPending;
        active.generated = undefined;
        active.generationPending = undefined;
        active.outputPending = undefined;
        render(active.paper?.matchStatus === 'unresolved' ? 'uncertain' : active.paper ? 'matched' : 'resolving');
        if (active.paper && active.paper.matchStatus !== 'unresolved') void loadOutput(active.token, active.paper, resumeGeneration);
      } else if (uiChanged) render();
    } catch { /* Keep the last known language if settings cannot be read. */ }
  };

  const enrich = async (expected: number, seed: PaperSeed) => {
    try {
      const resolution = await rpc<Resolution>({ type: 'RESOLVE', seed });
      if (!current(expected) || !active) return;
      active.resolution = resolution;
      active.paper = resolution.paper;
      render(resolution.paper.matchStatus === 'unresolved' ? 'uncertain' : 'matched');
      if (resolution.paper.matchStatus === 'unresolved') return;
      void loadOutput(expected, resolution.paper);
    } catch (error) {
      if (current(expected)) render('queryFailed', true, error instanceof Error ? error.message : undefined);
    }
  };

  const open = (element: Element, keyboard = false) => {
    if (active?.pinned && active.element !== element) return;
    const seed = parseResult(element); if (!seed) return;
    if (active?.element === element) return;
    if (hoverTimer) window.clearTimeout(hoverTimer);
    const expected = ++token;
    active = { element, seed, token: expected, pinned: false, keyboard, focusPending: keyboard };
    host.style.display = 'block'; positionPanel(); render();
    void enrich(expected, seed);
  };
  const scheduleOpen = (element: Element, keyboard = false) => {
    if (active?.pinned && active.element !== element) return;
    if (hoverTimer) window.clearTimeout(hoverTimer);
    hoverTimer = window.setTimeout(() => open(element, keyboard), HOVER_DELAY);
  };
  const onOver = (event: MouseEvent) => { const element = resultFor(event.target); if (element) scheduleOpen(element); };
  // A right-docked panel must remain reachable across the space between the
  // result title and the page edge. Leaving a title only cancels unopened previews.
  const onOut = (event: MouseEvent) => { if (resultFor(event.target)) { if (hoverTimer) window.clearTimeout(hoverTimer); hoverTimer = undefined; } };
  const onFocus = (event: FocusEvent) => { const element = resultFor(event.target); if (element) { if (element === suppressFocusTarget) { suppressFocusTarget = undefined; return; } scheduleOpen(element, true); } };
  const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && active) { event.preventDefault(); close(true); } };
  const onPointerDown = (event: PointerEvent) => { if (active && !active.pinned && !event.composedPath().includes(host) && !active.element.contains(event.target as Node)) close(); };
  const onCardClick = (event: Event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]'); if (!button || !active) return;
    const expected = active.token;
    if (button.dataset.action === 'close') { close(true); return; }
    if (button.dataset.action === 'pin') { active.pinned = !active.pinned; render(active.pinned ? 'pinned' : 'unpinned'); return; }
    if (button.disabled) return;
    if (button.dataset.action === 'reset-height') { panel.fullHeight = true; positionPanel(); return; }
    if (button.dataset.action === 'save' && active.paper) {
      const paper = active.paper;
      if (active.savePending === paper.id) return;
      pinPanel();
      active.savePending = paper.id; active.saveNotice = { key: 'saving', failure: false }; render();
      void rpc<SavedPaper>({ type: 'SAVE_PAPER', paperId: paper.id }).then(() => {
        if (!current(expected) || !active || active.paper !== paper) return;
        active.savePending = undefined; active.savedPaperId = paper.id;
        active.saveNotice = { key: paper.matchStatus === 'unresolved' ? 'savedUnresolved' : 'saved', failure: false }; render();
      }).catch(error => {
        if (!current(expected) || !active || active.paper !== paper) return;
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
  const onWindowFocus = () => { settingsReady = refreshSettings(); };
  settingsReady = refreshSettings();
  window.addEventListener('focus', onWindowFocus);
  window.addEventListener('resize', onResize);
  root.addEventListener('pointerdown', onResizeStart as EventListener);
  root.addEventListener('keydown', onResizeKey as EventListener);
  document.addEventListener('pointermove', onResizeMove, true);
  document.addEventListener('pointerup', onResizeEnd, true);
  document.addEventListener('pointercancel', onResizeEnd, true);
  document.addEventListener('mouseover', onOver, true); document.addEventListener('mouseout', onOut, true); document.addEventListener('focusin', onFocus, true); document.addEventListener('keydown', onKey, true); document.addEventListener('pointerdown', onPointerDown, true);
  root.addEventListener('click', onCardClick);
  const observer = new MutationObserver(() => { if (active && !active.element.isConnected && !active.pinned) close(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  return () => { stopped = true; close(); observer.disconnect(); window.removeEventListener('focus', onWindowFocus); window.removeEventListener('resize', onResize); document.removeEventListener('pointermove', onResizeMove, true); document.removeEventListener('pointerup', onResizeEnd, true); document.removeEventListener('pointercancel', onResizeEnd, true); document.removeEventListener('mouseover', onOver, true); document.removeEventListener('mouseout', onOut, true); document.removeEventListener('focusin', onFocus, true); document.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onPointerDown, true); host.remove(); };
}

if (typeof chrome !== 'undefined' && chrome.runtime?.id && typeof document !== 'undefined') startContentScript();
