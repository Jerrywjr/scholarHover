import { HOVER_DELAY } from '../shared/defaults.ts';
import { rpc } from '../shared/rpc.ts';
import { localizeError } from '../shared/errors.ts';
import { LANGUAGES, type Language } from '../shared/languages.ts';
import { contentText, type ContentMessageKey } from './messages.ts';
import type { Generated, Paper, PaperSeed, Resolution, SettingsView } from '../shared/types.ts';

const RESULT_SELECTOR = '.gs_r.gs_or.gs_scl';
const TITLE_SELECTOR = '.gs_rt';
const CARD_ID = 'scholar-hover-card';
const CLOSE_DELAY = 120;

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
};

type CardFocus =
  | { kind: 'button'; action: string; candidateId?: string }
  | { kind: 'summary' }
  | { kind: 'body' }
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
  host.style.cssText = 'position:fixed;z-index:2147483647;display:none;overflow:hidden;width:min(420px,calc(100vw - 24px));';
  host.attachShadow({ mode: 'open' });
  document.body.append(host);
  return host;
}

export function cardPlacement(rect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>, viewport: { width: number; height: number }): { left: number; top: number; maxHeight: number; side: 'right' | 'below' | 'above' } {
  const width = Math.min(420, Math.max(0, viewport.width - 24));
  const rightLeft = rect.right + 12;
  const alignedTop = Math.max(12, Math.min(rect.top, viewport.height - Math.min(320, viewport.height - 24) - 12));
  if (width >= 260 && rightLeft + width <= viewport.width - 12) {
    return { left: rightLeft, top: alignedTop, maxHeight: Math.max(80, viewport.height - alignedTop - 12), side: 'right' };
  }
  const left = Math.max(12, Math.min(viewport.width - width - 12, rect.left));
  const belowTop = Math.max(12, rect.bottom + 8);
  const below = viewport.height - belowTop - 12;
  const above = rect.top - 12;
  const placeAbove = below < 220 && above > below;
  return { left, top: placeAbove ? 12 : belowTop, maxHeight: Math.max(80, placeAbove ? above : below), side: placeAbove ? 'above' : 'below' };
}

function position(host: HTMLElement, target: Element): void {
  const placement = cardPlacement(target.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight });
  host.style.left = `${placement.left}px`;
  host.style.top = `${placement.top}px`;
  host.style.maxHeight = `${placement.maxHeight}px`;
  host.style.setProperty('--card-max-height', `${placement.maxHeight}px`);
}

function moveWithinViewport(host: HTMLElement, left: number, top: number): void {
  const rect = host.getBoundingClientRect();
  const width = rect.width || Math.min(420, window.innerWidth - 24);
  const height = Math.min(rect.height, Math.max(0, window.innerHeight - 24));
  const x = Math.max(12, Math.min(left, window.innerWidth - width - 12));
  const y = Math.max(12, Math.min(top, window.innerHeight - height - 12));
  // Keep the existing height limit while moving upward, so a long card does not
  // grow to fill the screen and become impossible to drag back down.
  const previousMaxHeight = Number.parseFloat(host.style.maxHeight) || window.innerHeight - 24;
  const maxHeight = Math.min(previousMaxHeight, Math.max(0, window.innerHeight - y - 12));
  host.style.left = `${x}px`; host.style.top = `${y}px`;
  host.style.maxHeight = `${maxHeight}px`;
  host.style.setProperty('--card-max-height', `${maxHeight}px`);
}

function addStyle(root: ShadowRoot): void {
  const style = document.createElement('style');
  style.textContent = `
    :host { color:#172b3a; font:13px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; }
    * { box-sizing:border-box; } .card { display:flex; flex-direction:column; background:#fff; border:1px solid #d9e5e8; border-radius:12px; box-shadow:0 10px 30px rgba(22,48,65,.18); max-height:var(--card-max-height,calc(100vh - 24px)); overflow:hidden; }
    .head { display:flex; flex-shrink:0; gap:10px; align-items:flex-start; padding:14px 14px 11px; border-top:3px solid #0d6f78; cursor:grab; touch-action:none; user-select:none; } :host([data-dragging]) .head { cursor:grabbing; } .title-group { flex:1; min-width:0; } .drag-hint { display:block; color:#627d86; font-size:10px; margin-top:5px; } h2 { margin:0; min-width:0; max-height:6em; overflow:auto; overflow-wrap:anywhere; color:#102a43; font-size:15px; line-height:1.4; font-weight:650; } button { border:1px solid #c5d6da; border-radius:7px; background:#fff; color:#174e5a; cursor:pointer; font:inherit; padding:5px 8px; } button:hover { background:#eff7f7; } button:disabled { cursor:wait; opacity:.7; } button:focus-visible,a:focus-visible,.body:focus-visible { outline:2px solid #1596a6; outline-offset:-2px; }
    .actions { display:flex; flex-shrink:0; gap:5px; } .body { flex:1 1 auto; min-height:0; overflow-y:auto; overscroll-behavior:contain; scrollbar-gutter:stable; overflow-wrap:anywhere; padding:0 14px 14px; } .meta { color:#516773; margin:0 0 9px; } .translated { color:#0d5863; margin:0 0 10px; font-size:14px; font-weight:600; } .section { border-top:1px solid #e5edef; padding-top:10px; margin-top:10px; } .label { display:block; color:#42616b; font-size:11px; font-weight:650; letter-spacing:.02em; margin-bottom:3px; } .status { color:#42616b; margin:0 0 9px; overflow-wrap:anywhere; } .warning { color:#805b16; background:#fff8e8; border-radius:6px; padding:7px 8px; margin:8px 0; } .sources { color:#617883; font-size:11px; margin:10px 0 0; } .source-link { color:#0d6672; } details { margin-top:8px; } summary { color:#235764; cursor:pointer; } .candidate { display:block; width:100%; text-align:left; margin:6px 0; padding:8px; } .candidate small { display:block; color:#59707b; margin-top:2px; } .footer { flex-shrink:0; padding:10px 14px 12px; border-top:1px solid #e5edef; background:#f8fbfc; } .footer-actions { display:flex; align-items:center; gap:7px; flex-wrap:wrap; } .original { color:#0d6672; text-decoration:none; } .failure { color:#a33b30; } @media (max-width:480px) { .head { padding:12px; } .body { padding:0 12px 12px; } }
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
  let closeTimer: number | undefined;
  let suppressFocusTarget: Element | undefined;
  let drag: { pointerId: number; x: number; y: number; left: number; top: number; moved: boolean } | undefined;
  const failedGenerationAttempts = new Set<string>();
  let preferences: SettingsView = { uiLanguage: 'zh-CN', outputLanguage: 'zh-CN', baseUrl: '', model: '', autoGenerate: false, consent: false, rememberKey: false, hasApiKey: false, hasOpenAlexKey: false };
  let configRevision = 0;
  let settingsRead = 0;
  let stopped = false;
  let settingsReady: Promise<void>;
  const label = (key: ContentMessageKey) => contentText(key, preferences.uiLanguage, preferences.outputLanguage);

  const current = (expected: number) => active?.token === expected && host.isConnected;
  const finishDrag = () => {
    if (drag) { try { host.releasePointerCapture?.(drag.pointerId); } catch { /* Pointer already released. */ } }
    drag = undefined;
    delete host.dataset.dragging;
  };
  const close = (restoreFocus = false) => {
    const prior = active;
    active = undefined;
    finishDrag();
    token += 1;
    if (hoverTimer) window.clearTimeout(hoverTimer);
    if (closeTimer) window.clearTimeout(closeTimer);
    hoverTimer = closeTimer = undefined;
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
    card.setAttribute('aria-busy', String(!!active.generationPending));
    const head = document.createElement('div'); head.className = 'head';
    head.title = label('dragHint');
    const heading = document.createElement('h2'); heading.id = 'scholar-hover-heading'; heading.textContent = active.paper?.title || active.seed.title;
    const titleGroup = document.createElement('div'); titleGroup.className = 'title-group';
    titleGroup.append(heading); text(titleGroup, label('dragHint'), 'drag-hint'); head.append(titleGroup);
    const actions = document.createElement('div'); actions.className = 'actions';
    actions.append(cardButton(label(active.pinned ? 'unpin' : 'pin'), 'pin', active.pinned), cardButton(label('close'), 'close'));
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
    footer.append(footerActions); card.append(body, footer); root.append(card);
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
    host.style.display = 'block'; position(host, element); render();
    void enrich(expected, seed);
  };
  const scheduleOpen = (element: Element, keyboard = false) => {
    if (active?.pinned && active.element !== element) return;
    if (hoverTimer) window.clearTimeout(hoverTimer);
    hoverTimer = window.setTimeout(() => open(element, keyboard), HOVER_DELAY);
  };
  const scheduleClose = (related: EventTarget | null) => {
    if (drag || active?.pinned || (related instanceof Node && (active?.element.contains(related) || host.contains(related)))) return;
    if (closeTimer) window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => close(), CLOSE_DELAY);
  };

  const onOver = (event: MouseEvent) => { const element = resultFor(event.target); if (element) { if (closeTimer) window.clearTimeout(closeTimer); scheduleOpen(element); } };
  const onOut = (event: MouseEvent) => { if (resultFor(event.target)) { if (hoverTimer) window.clearTimeout(hoverTimer); hoverTimer = undefined; scheduleClose(event.relatedTarget); } };
  const onFocus = (event: FocusEvent) => { const element = resultFor(event.target); if (element) { if (element === suppressFocusTarget) { suppressFocusTarget = undefined; return; } scheduleOpen(element, true); } };
  const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && active) { event.preventDefault(); close(true); } };
  const onPointerDown = (event: PointerEvent) => { if (active && !active.pinned && !event.composedPath().includes(host) && !active.element.contains(event.target as Node)) close(); };
  const onHostOver = () => { if (closeTimer) window.clearTimeout(closeTimer); };
  const onHostOut = (event: MouseEvent) => { if (!(event.relatedTarget instanceof Node && host.contains(event.relatedTarget))) scheduleClose(event.relatedTarget); };
  const onCardClick = (event: Event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]'); if (!button || !active) return;
    const expected = active.token;
    if (button.dataset.action === 'close') { close(true); return; }
    if (button.dataset.action === 'pin') { active.pinned = !active.pinned; render(active.pinned ? 'pinned' : 'unpinned'); return; }
    if (button.dataset.action === 'settings') { void rpc<void>({ type: 'OPEN_SETTINGS' }).catch(() => render('settingsFailed', true)); return; }
    if (button.dataset.action === 'generate' && active.paper) {
      active.pinned = true;
      if (closeTimer) window.clearTimeout(closeTimer);
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
        active.resolution = resolution; active.paper = resolution.paper; active.generated = undefined; render('confirmed');
        void loadOutput(expected, resolution.paper);
      }).catch(error => current(expected) && render('confirmFailed', true, error instanceof Error ? error.message : undefined));
    }
  };
  const onDragStart = (event: PointerEvent) => {
    const target = event.target;
    if (!active || event.button !== 0 || !(target instanceof Element) || !target.closest('.head') || target.closest('button,a,input,select,textarea')) return;
    const rect = host.getBoundingClientRect();
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
    if (hoverTimer) window.clearTimeout(hoverTimer);
    if (closeTimer) window.clearTimeout(closeTimer);
    try { host.setPointerCapture?.(event.pointerId); } catch { /* Synthetic pointer events do not support capture. */ }
    event.preventDefault();
  };
  const onDragMove = (event: PointerEvent) => {
    if (!drag || !active || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.x; const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true; active.pinned = true; host.dataset.dragging = 'true';
    const pin = root.querySelector<HTMLButtonElement>('[data-action="pin"]');
    if (pin) { pin.textContent = label('unpin'); pin.setAttribute('aria-pressed', 'true'); }
    moveWithinViewport(host, drag.left + dx, drag.top + dy);
    event.preventDefault();
  };
  const onDragEnd = (event: PointerEvent) => { if (drag?.pointerId === event.pointerId) finishDrag(); };
  const onResize = () => {
    if (!active) return;
    const rect = host.getBoundingClientRect();
    moveWithinViewport(host, rect.left, rect.top);
  };
  const onWindowFocus = () => { settingsReady = refreshSettings(); };
  settingsReady = refreshSettings();
  window.addEventListener('focus', onWindowFocus);
  window.addEventListener('resize', onResize);
  root.addEventListener('pointerdown', onDragStart as EventListener);
  document.addEventListener('pointermove', onDragMove, true);
  document.addEventListener('pointerup', onDragEnd, true);
  document.addEventListener('pointercancel', onDragEnd, true);
  document.addEventListener('mouseover', onOver, true); document.addEventListener('mouseout', onOut, true); document.addEventListener('focusin', onFocus, true); document.addEventListener('keydown', onKey, true); document.addEventListener('pointerdown', onPointerDown, true);
  host.addEventListener('mouseover', onHostOver); host.addEventListener('mouseout', onHostOut); root.addEventListener('click', onCardClick);
  const observer = new MutationObserver(() => { if (active && !active.element.isConnected && !active.pinned) close(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  return () => { stopped = true; close(); observer.disconnect(); window.removeEventListener('focus', onWindowFocus); window.removeEventListener('resize', onResize); document.removeEventListener('pointermove', onDragMove, true); document.removeEventListener('pointerup', onDragEnd, true); document.removeEventListener('pointercancel', onDragEnd, true); document.removeEventListener('mouseover', onOver, true); document.removeEventListener('mouseout', onOut, true); document.removeEventListener('focusin', onFocus, true); document.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onPointerDown, true); host.remove(); };
}

if (typeof chrome !== 'undefined' && chrome.runtime?.id && typeof document !== 'undefined') startContentScript();
