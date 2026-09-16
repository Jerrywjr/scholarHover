import { LANGUAGES } from '../shared/languages';
import type { CollectionSnapshot, Generated, Paper, SavedPaper } from '../shared/types';

export const COLLECTION_MAX_ITEMS = 200;
export const COLLECTION_MAX_BYTES = 4 * 1024 * 1024;
const INVALID = '缓存文章数据无效。';
const STALE = '缓存列表已更新，请刷新后重试。';

type Storage = { read(): Promise<unknown>; write(value: CollectionSnapshot): Promise<void> };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const optionalText = (value: unknown): boolean => value === undefined || typeof value === 'string';
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function validPaper(value: unknown): value is Paper {
  if (!record(value)) return false;
  return typeof value.id === 'string' && !!value.id.trim()
    && typeof value.title === 'string' && !!value.title.trim()
    && Array.isArray(value.authors) && value.authors.every(author => typeof author === 'string')
    && typeof value.url === 'string' && typeof value.sourceUrl === 'string'
    && ['OpenAlex', 'Crossref', 'Google Scholar'].includes(value.source as string)
    && ['matched', 'confirmed', 'unresolved'].includes(value.matchStatus as string)
    && (value.year === undefined || (Number.isInteger(value.year) && (value.year as number) > 0))
    && ['venue', 'doi', 'abstract', 'downloadUrl', 'downloadVersion'].every(key => optionalText(value[key]))
    && (value.preprint === undefined || typeof value.preprint === 'boolean')
    && (value.sources === undefined || (Array.isArray(value.sources) && value.sources.every(source =>
      record(source) && typeof source.name === 'string' && typeof source.url === 'string')));
}

function validGenerated(value: unknown): value is Generated {
  if (!record(value)) return false;
  return typeof value.titleTranslated === 'string' && typeof value.model === 'string'
    && typeof value.fingerprint === 'string' && LANGUAGES.includes(value.language as Generated['language'])
    && (value.abstractTranslated === null || typeof value.abstractTranslated === 'string')
    && (value.summary === null || typeof value.summary === 'string') && timestamp(value.createdAt);
}

function validSaved(value: unknown): value is SavedPaper {
  return record(value) && validPaper(value.paper) && value.id === value.paper.id
    && timestamp(value.savedAt) && timestamp(value.updatedAt)
    && (value.generated === undefined || validGenerated(value.generated));
}

function contentIdentity(paper: Paper): string {
  // Mirror all model input fields and include publication version. A new PDF URL
  // alone does not change the source text that the saved translation describes.
  return JSON.stringify({
    id: paper.id, title: paper.title, authors: paper.authors, year: paper.year, venue: paper.venue,
    url: paper.url, doi: paper.doi, abstract: paper.abstract, source: paper.source, sourceUrl: paper.sourceUrl,
    preprint: paper.preprint, downloadVersion: paper.downloadVersion,
  });
}

function enforceCapacity(snapshot: CollectionSnapshot): void {
  if (snapshot.items.length > COLLECTION_MAX_ITEMS) throw new Error('缓存文章已达 200 篇上限，请先删除部分文章。');
  if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > COLLECTION_MAX_BYTES) {
    throw new Error('缓存文章超过 4 MiB 容量，请先删除部分文章。');
  }
}

function parseSnapshot(value: unknown): CollectionSnapshot {
  if (value === undefined) return { revision: 0, items: [] };
  if (!record(value) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0
    || !Array.isArray(value.items) || !value.items.every(validSaved)
    || new Set(value.items.map(item => item.id)).size !== value.items.length) throw new Error(INVALID);
  return structuredClone(value as unknown as CollectionSnapshot);
}

export function createCollectionStore(storage: Storage) {
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(action: () => Promise<T>): Promise<T> {
    const operation = queue.then(action, action);
    queue = operation.catch(() => undefined);
    return operation;
  }
  const read = async () => parseSnapshot(await storage.read());
  const checkRevision = (snapshot: CollectionSnapshot, revision: number) => {
    if (!Number.isSafeInteger(revision) || revision !== snapshot.revision) throw new Error(STALE);
  };
  async function commit(snapshot: CollectionSnapshot): Promise<CollectionSnapshot> {
    if (!Number.isSafeInteger(snapshot.revision + 1)) throw new Error(INVALID);
    const next = { revision: snapshot.revision + 1, items: snapshot.items };
    enforceCapacity(next);
    await storage.write(structuredClone(next));
    return structuredClone(next);
  }
  return {
    list(): Promise<CollectionSnapshot> {
      return serial(read);
    },
    save(paper: Paper, generated?: Generated): Promise<SavedPaper> {
      // Snapshot arguments now, before any earlier asynchronous mutation runs.
      if (!validPaper(paper) || (generated !== undefined && !validGenerated(generated))) return Promise.reject(new Error(INVALID));
      const input = structuredClone(paper);
      const translation = generated === undefined ? undefined : structuredClone(generated);
      return serial(async () => {
        const snapshot = await read();
        const index = snapshot.items.findIndex(item => item.id === input.id);
        const existing = snapshot.items[index];
        const now = Date.now();
        const entry: SavedPaper = {
          id: input.id, paper: input, savedAt: existing?.savedAt ?? now, updatedAt: now,
          generated: translation ?? (existing && contentIdentity(existing.paper) === contentIdentity(input) ? existing.generated : undefined),
        };
        if (index < 0) snapshot.items.push(entry);
        else snapshot.items[index] = entry;
        await commit(snapshot);
        return structuredClone(entry);
      });
    },
    updateGenerated(paper: Paper, generated: Generated): Promise<void> {
      if (!validPaper(paper) || !validGenerated(generated)) return Promise.reject(new Error(INVALID));
      const identity = contentIdentity(paper);
      const id = paper.id;
      const translation = structuredClone(generated);
      return serial(async () => {
        const snapshot = await read();
        const existing = snapshot.items.find(item => item.id === id);
        // A completed model request must neither recreate a removed record nor
        // attach its result to a newly saved revision of a different paper.
        if (!existing || contentIdentity(existing.paper) !== identity) return;
        existing.generated = translation;
        existing.updatedAt = Date.now();
        await commit(snapshot);
      });
    },
    remove(id: string, revision: number): Promise<CollectionSnapshot> {
      return serial(async () => {
        const snapshot = await read();
        checkRevision(snapshot, revision);
        const index = snapshot.items.findIndex(item => item.id === id);
        if (index < 0) throw new Error('缓存文章不存在，请刷新后重试。');
        snapshot.items.splice(index, 1);
        return commit(snapshot);
      });
    },
    reorder(ids: string[], revision: number): Promise<CollectionSnapshot> {
      const orderedIds = Array.isArray(ids) ? [...ids] : [];
      return serial(async () => {
        const snapshot = await read();
        checkRevision(snapshot, revision);
        const entries = new Map(snapshot.items.map(item => [item.id, item]));
        if (!Array.isArray(ids) || orderedIds.length !== entries.size || new Set(orderedIds).size !== entries.size
          || orderedIds.some(id => !entries.has(id))) throw new Error('文章排序无效，请刷新后重试。');
        snapshot.items = orderedIds.map(id => entries.get(id)!);
        return commit(snapshot);
      });
    },
    clear(revision: number): Promise<CollectionSnapshot> {
      return serial(async () => {
        const snapshot = await read();
        checkRevision(snapshot, revision);
        snapshot.items = [];
        return commit(snapshot);
      });
    },
  };
}
