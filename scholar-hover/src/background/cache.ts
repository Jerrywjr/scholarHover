import type { Generated, Paper, PaperSeed, Resolution } from '../shared/types';
import { LANGUAGES, type Language } from '../shared/languages';
import { previewKey } from '../shared/identity';
import { createIndexedDBArchive, type ArchiveBackend, type LegacyGeneratedEntry } from './archive';

const CACHE_PREFIX = 'generated:';
const READ_ERROR = '无法读取本地归档，请重试；现有数据未删除。';
const WRITE_ERROR = '无法保存本地归档，请检查可用空间后重试；现有数据未删除。';
const MIGRATION_ERROR = '本地归档迁移未完成，旧数据已保留，请重试。';
const CLEAR_ERROR = '无法清除本地归档，请重试。';

interface LegacyStorage {
  read(): Promise<Record<string, unknown>>;
  remove(keys: string[]): Promise<void>;
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
    && typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt);
}

function isPaper(value: unknown): value is Paper {
  if (!value || typeof value !== 'object') return false;
  const paper = value as Partial<Paper>;
  return typeof paper.id === 'string' && typeof paper.title === 'string'
    && Array.isArray(paper.authors) && paper.authors.every(author => typeof author === 'string')
    && typeof paper.url === 'string' && typeof paper.sourceUrl === 'string'
    && ['OpenAlex', 'Crossref', 'Google Scholar', 'Original page'].includes(paper.source ?? '')
    && ['matched', 'confirmed', 'unresolved'].includes(paper.matchStatus ?? '');
}

function isResolution(value: unknown): value is Resolution {
  if (!value || typeof value !== 'object') return false;
  const resolution = value as Partial<Resolution>;
  return isPaper(resolution.paper) && Array.isArray(resolution.candidates) && resolution.candidates.every(isPaper)
    && (resolution.warning === undefined || typeof resolution.warning === 'string');
}

export function createCache(archive: ArchiveBackend, legacy: LegacyStorage) {
  let operations: Promise<void> = Promise.resolve();
  let migrated = false;

  function serial<T>(action: () => Promise<T>): Promise<T> {
    const operation = operations.then(action, action);
    operations = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async function migrate(): Promise<void> {
    if (migrated) return;
    try {
      const entries: LegacyGeneratedEntry[] = Object.entries(await legacy.read())
        .filter(([key]) => key.startsWith(CACHE_PREFIX))
        .map(([key, value]) => ({ key, value, generated: isGenerated(value) && key === `${CACHE_PREFIX}${value.fingerprint}` ? value : undefined }));
      if (entries.length) {
        // importLegacy resolves only after the whole IDB transaction commits.
        // Failed migration leaves the chrome.storage source records intact.
        await archive.importLegacy(entries);
        await legacy.remove(entries.map(entry => entry.key));
      }
      migrated = true;
    } catch {
      throw new Error(MIGRATION_ERROR);
    }
  }

  function read<T>(action: () => Promise<T>): Promise<T> {
    return serial(async () => {
      await migrate();
      try { return await action(); } catch { throw new Error(READ_ERROR); }
    });
  }

  function write(action: () => Promise<void>): Promise<void> {
    return serial(async () => {
      await migrate();
      try { await action(); } catch { throw new Error(WRITE_ERROR); }
    });
  }

  return {
    getCached(fingerprint: string): Promise<Generated | undefined> {
      return read(async () => {
        const value = await archive.getGenerated(fingerprint);
        if (value === undefined) return undefined;
        if (!isGenerated(value) || value.fingerprint !== fingerprint) throw new Error(READ_ERROR);
        return value;
      });
    },
    putCached(value: Generated): Promise<void> {
      return write(async () => {
        if (!isGenerated(value)) throw new Error(WRITE_ERROR);
        await archive.putGenerated(value);
      });
    },
    getPreview(seed: PaperSeed): Promise<Resolution | undefined> {
      return read(async () => {
        const value = await archive.getPreview(previewKey(seed));
        if (value === undefined) return undefined;
        if (!isResolution(value)) throw new Error(READ_ERROR);
        return value;
      });
    },
    putPreview(seed: PaperSeed, resolution: Resolution): Promise<void> {
      return write(async () => {
        if (!isResolution(resolution)) throw new Error(WRITE_ERROR);
        await archive.putPreview(previewKey(seed), resolution);
      });
    },
    clearCache(): Promise<void> {
      return serial(async () => {
        try {
          const keys = Object.keys(await legacy.read()).filter(key => key.startsWith(CACHE_PREFIX));
          await archive.clear();
          if (keys.length) await legacy.remove(keys);
          migrated = true;
        } catch {
          throw new Error(CLEAR_ERROR);
        }
      });
    },
  };
}

const cache = createCache(createIndexedDBArchive(), {
  read: () => chrome.storage.local.get(null),
  remove: keys => chrome.storage.local.remove(keys),
});

export const { getCached, putCached, getPreview, putPreview, clearCache } = cache;
