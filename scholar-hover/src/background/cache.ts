import { CACHE_MAX, CACHE_TTL } from '../shared/defaults';
import type { Generated } from '../shared/types';
import { LANGUAGES, type Language } from '../shared/languages';

const CACHE_PREFIX = 'generated:';
const CACHE_MAX_BYTES = 4 * 1024 * 1024;
let writes: Promise<void> = Promise.resolve();

function cacheKey(fingerprint: string): string {
  return `${CACHE_PREFIX}${fingerprint}`;
}

function isGenerated(value: unknown): value is Generated {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Generated>;
  return LANGUAGES.includes(candidate.language as Language)
    && typeof candidate.titleTranslated === 'string'
    && (typeof candidate.abstractTranslated === 'string' || candidate.abstractTranslated === null)
    && (typeof candidate.summary === 'string' || candidate.summary === null)
    && typeof candidate.model === 'string'
    && typeof candidate.fingerprint === 'string'
    && typeof candidate.createdAt === 'number';
}

function isExpired(value: Generated, now = Date.now()): boolean {
  return value.createdAt < now - CACHE_TTL || value.createdAt > now + CACHE_TTL;
}

function storedBytes(key: string, value: Generated): number {
  return new TextEncoder().encode(key).byteLength + new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function serialWrite(action: () => Promise<void>): Promise<void> {
  const operation = writes.then(action, action);
  writes = operation.catch(() => undefined);
  return operation;
}

async function currentEntries(): Promise<Array<[string, unknown]>> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all).filter(([key]) => key.startsWith(CACHE_PREFIX));
}

async function pruneAndStore(nextKey?: string, nextValue?: Generated): Promise<void> {
  const now = Date.now();
  const entries: Array<[string, Generated]> = [];
  const remove = new Set<string>();
  for (const [key, value] of await currentEntries()) {
    if (isGenerated(value) && !isExpired(value, now) && key === cacheKey(value.fingerprint)) entries.push([key, value]);
    else remove.add(key);
  }
  if (nextKey && nextValue && storedBytes(nextKey, nextValue) <= CACHE_MAX_BYTES) {
    const existing = entries.findIndex(([key]) => key === nextKey);
    if (existing >= 0) entries.splice(existing, 1);
    entries.push([nextKey, nextValue]);
  }

  entries.sort(([, a], [, b]) => a.createdAt - b.createdAt);
  let bytes = entries.reduce((total, [key, value]) => total + storedBytes(key, value), 0);
  while (entries.length > CACHE_MAX || bytes > CACHE_MAX_BYTES) {
    const [key, value] = entries.shift()!;
    remove.add(key);
    bytes -= storedBytes(key, value);
  }
  if (remove.size) await chrome.storage.local.remove([...remove]);
  if (nextKey && nextValue && entries.some(([key]) => key === nextKey)) await chrome.storage.local.set({ [nextKey]: nextValue });
}

export async function getCached(fingerprint: string): Promise<Generated | undefined> {
  const key = cacheKey(fingerprint);
  const result = await chrome.storage.local.get(key);
  const value = result[key];
  if (!isGenerated(value) || value.fingerprint !== fingerprint) {
    if (value !== undefined) await serialWrite(() => pruneAndStore());
    return undefined;
  }
  if (isExpired(value)) {
    await serialWrite(() => pruneAndStore());
    return undefined;
  }
  return value;
}

export async function putCached(value: Generated): Promise<void> {
  if (!isGenerated(value)) throw new Error('缓存内容无效');
  await serialWrite(() => pruneAndStore(cacheKey(value.fingerprint), value));
}

export async function clearCache(): Promise<void> {
  await serialWrite(async () => {
    const entries = await currentEntries();
    if (entries.length) await chrome.storage.local.remove(entries.map(([key]) => key));
  });
}
