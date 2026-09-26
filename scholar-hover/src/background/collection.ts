import { LANGUAGES } from '../shared/languages';
import type { CollectionSnapshot, Generated, Paper, PaperCompletion, PaperSeed, SavedPaper } from '../shared/types';

export const COLLECTION_MAX_ITEMS = 200;
export const COLLECTION_MAX_BYTES = 4 * 1024 * 1024;
const INVALID = '缓存文章数据无效。';
const STALE = '缓存列表已更新，请刷新后重试。';

type Storage = { read(): Promise<unknown>; write(value: CollectionSnapshot): Promise<void> };
type SaveContext = Pick<SavedPaper, 'sourceKey' | 'seed' | 'completion' | 'candidates'>;
type SavedPatch = Partial<Pick<SavedPaper, 'paper' | 'generated' | 'completion' | 'candidates'>>;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const optionalText = (value: unknown): boolean => value === undefined || typeof value === 'string';
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const identifier = (value: unknown): value is string => typeof value === 'string' && !!value.trim();

function validSeed(value: unknown): value is PaperSeed {
  if (!record(value)) return false;
  return identifier(value.title)
    && Array.isArray(value.authors) && value.authors.every(author => typeof author === 'string')
    && typeof value.url === 'string'
    && (value.year === undefined || (Number.isInteger(value.year) && (value.year as number) > 0))
    && ['venue', 'doi'].every(key => optionalText(value[key]))
    && (value.preprint === undefined || typeof value.preprint === 'boolean');
}

function validPaper(value: unknown): value is Paper {
  if (!record(value) || !validSeed(value)) return false;
  return identifier(value.id) && typeof value.sourceUrl === 'string'
    && ['OpenAlex', 'Crossref', 'Google Scholar', 'Original page', 'Link'].includes(value.source as string)
    && ['matched', 'confirmed', 'unresolved'].includes(value.matchStatus as string)
    && ['venue', 'doi', 'abstract', 'downloadUrl', 'downloadVersion'].every(key => optionalText(value[key]))
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

function validCompletion(value: unknown): value is PaperCompletion {
  return record(value) && timestamp(value.updatedAt) && optionalText(value.error)
    && ['queued', 'resolving', 'generating', 'ready', 'needs-confirmation', 'needs-configuration', 'failed', 'interrupted'].includes(value.status as string);
}

function validContext(value: unknown): value is SaveContext {
  return record(value)
    && (value.sourceKey === undefined || identifier(value.sourceKey))
    && (value.seed === undefined || validSeed(value.seed))
    && (value.completion === undefined || validCompletion(value.completion))
    && (value.candidates === undefined || (Array.isArray(value.candidates) && value.candidates.every(validPaper)));
}

function validSaved(value: unknown): value is SavedPaper {
  return record(value) && identifier(value.id) && validPaper(value.paper)
    && timestamp(value.savedAt) && timestamp(value.updatedAt)
    && (value.generated === undefined || validGenerated(value.generated)) && validContext(value);
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
  // A later incarnation of a deleted entry needs a different job token even
  // when both saves happen in the same millisecond or the system clock moves.
  let latestSavedAt = -1;
  function serial<T>(action: () => Promise<T>): Promise<T> {
    const operation = queue.then(action, action);
    queue = operation.catch(() => undefined);
    return operation;
  }
  const read = async () => {
    const snapshot = parseSnapshot(await storage.read());
    for (const item of snapshot.items) latestSavedAt = Math.max(latestSavedAt, item.savedAt);
    return snapshot;
  };
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
    save(paper: Paper, generated?: Generated, context: SaveContext = {}): Promise<SavedPaper> {
      // Snapshot arguments now, before any earlier asynchronous mutation runs.
      if (!validPaper(paper) || (generated !== undefined && !validGenerated(generated)) || !validContext(context)) return Promise.reject(new Error(INVALID));
      const input = structuredClone(paper);
      const translation = generated === undefined ? undefined : structuredClone(generated);
      const source = structuredClone(context);
      return serial(async () => {
        const snapshot = await read();
        let index = source.sourceKey === undefined ? -1 : snapshot.items.findIndex(item => item.sourceKey === source.sourceKey);
        if (index < 0) index = snapshot.items.findIndex(item => item.paper.id === input.id && contentIdentity(item.paper) === contentIdentity(input));
        if (index < 0) index = snapshot.items.findIndex(item => item.paper.id === input.id);
        if (index < 0) index = snapshot.items.findIndex(item => item.id === input.id);
        const existing = snapshot.items[index];
        const now = Date.now();
        const preserveEnriched = existing !== undefined && input.matchStatus === 'unresolved' && existing.paper.matchStatus !== 'unresolved';
        const nextPaper = preserveEnriched ? existing.paper : input;
        const unchanged = existing !== undefined && contentIdentity(existing.paper) === contentIdentity(nextPaper);
        const savedAt = existing?.savedAt ?? Math.max(now, latestSavedAt + 1);
        const retainCompletion = preserveEnriched || (unchanged && source.completion?.status === 'queued' && existing?.completion !== undefined);
        const entry: SavedPaper = {
          id: existing?.id ?? input.id, paper: nextPaper, savedAt, updatedAt: Math.max(now, savedAt),
          sourceKey: existing?.sourceKey ?? source.sourceKey,
          seed: existing?.seed ?? source.seed,
          completion: retainCompletion ? existing?.completion : source.completion ?? (unchanged ? existing?.completion : undefined),
          candidates: preserveEnriched ? existing.candidates : source.candidates ?? (unchanged ? existing?.candidates : undefined),
          generated: preserveEnriched ? existing.generated : translation ?? (unchanged ? existing?.generated : undefined),
        };
        if (index < 0) snapshot.items.push(entry);
        else snapshot.items[index] = entry;
        await commit(snapshot);
        latestSavedAt = Math.max(latestSavedAt, savedAt);
        return structuredClone(entry);
      });
    },
    update(id: string, savedAt: number, patch: SavedPatch, expectedPaper?: Paper): Promise<SavedPaper | undefined> {
      if (!identifier(id) || !timestamp(savedAt) || !validContext(patch)
        || (patch.paper !== undefined && !validPaper(patch.paper))
        || (patch.generated !== undefined && !validGenerated(patch.generated))) return Promise.reject(new Error(INVALID));
      const input = structuredClone(patch);
      const expectedIdentity = expectedPaper ? contentIdentity(expectedPaper) : undefined;
      return serial(async () => {
        const snapshot = await read();
        const existing = snapshot.items.find(item => item.id === id && item.savedAt === savedAt);
        if (!existing || (expectedIdentity !== undefined && contentIdentity(existing.paper) !== expectedIdentity)) return undefined;
        const nextPaper = input.paper ?? existing.paper;
        const unchanged = contentIdentity(existing.paper) === contentIdentity(nextPaper);
        // Distinct saved entries may resolve to the same canonical paper. Keep
        // their identities and versions separate instead of transferring jobs
        // or translations between entries during an asynchronous update.
        existing.paper = nextPaper;
        existing.generated = input.generated ?? (unchanged ? existing.generated : undefined);
        if (input.completion !== undefined) existing.completion = input.completion;
        if (input.candidates !== undefined) existing.candidates = input.candidates;
        existing.updatedAt = Math.max(Date.now(), existing.savedAt);
        await commit(snapshot);
        return structuredClone(existing);
      });
    },
    updateGenerated(paper: Paper, generated: Generated): Promise<void> {
      if (!validPaper(paper) || !validGenerated(generated)) return Promise.reject(new Error(INVALID));
      const identity = contentIdentity(paper);
      const id = paper.id;
      const translation = structuredClone(generated);
      return serial(async () => {
        const snapshot = await read();
        const existing = snapshot.items.find(item => item.paper.id === id && contentIdentity(item.paper) === identity);
        // A completed model request must neither recreate a removed record nor
        // attach its result to a newly saved revision of a different paper.
        if (!existing) return;
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
