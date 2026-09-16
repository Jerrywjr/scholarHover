import type { Generated, Resolution } from '../shared/types';

export interface LegacyGeneratedEntry {
  key: string;
  value: unknown;
  generated?: Generated;
}

/** Storage boundary for the durable archive; cache policy is independent of IDB. */
export interface ArchiveBackend {
  getGenerated(fingerprint: string): Promise<unknown>;
  putGenerated(value: Generated): Promise<void>;
  getPreview(key: string): Promise<unknown>;
  putPreview(key: string, value: Resolution): Promise<void>;
  importLegacy(entries: LegacyGeneratedEntry[]): Promise<void>;
  clear(): Promise<void>;
}

const STORES = ['generated', 'previews', 'legacyGenerated'] as const;

export function createIndexedDBArchive(databaseName = 'scholar-hover-archive'): ArchiveBackend {
  let connection: Promise<IDBDatabase> | undefined;

  function open(): Promise<IDBDatabase> {
    if (connection) return connection;
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      let blocked = false;
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('generated')) db.createObjectStore('generated', { keyPath: 'fingerprint' });
        if (!db.objectStoreNames.contains('previews')) db.createObjectStore('previews', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('legacyGenerated')) db.createObjectStore('legacyGenerated', { keyPath: 'key' });
      };
      request.onerror = () => reject(request.error ?? new Error('Archive database could not open'));
      request.onblocked = () => {
        blocked = true;
        reject(new Error('Archive database upgrade is blocked'));
      };
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) { db.close(); return; }
        db.onversionchange = () => { db.close(); connection = undefined; };
        db.onclose = () => { connection = undefined; };
        resolve(db);
      };
    });
    connection = opening;
    void opening.catch(() => { if (connection === opening) connection = undefined; });
    return opening;
  }

  async function transaction<T>(stores: string[], mode: IDBTransactionMode, action: (tx: IDBTransaction, result: (value: T) => void) => void): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined);
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(tx.error ?? new Error('Archive transaction was aborted'));
      tx.onerror = () => reject(tx.error ?? new Error('Archive transaction failed'));
      try {
        action(tx, result => { value = result; });
      } catch (error) {
        tx.abort();
        reject(error);
      }
    });
  }

  return {
    getGenerated(fingerprint) {
      return transaction<unknown>(['generated'], 'readonly', (tx, result) => {
        const request = tx.objectStore('generated').get(fingerprint);
        request.onsuccess = () => result(request.result);
      });
    },
    putGenerated(value) {
      return transaction<void>(['generated'], 'readwrite', tx => { tx.objectStore('generated').put(value); });
    },
    getPreview(key) {
      return transaction<unknown>(['previews'], 'readonly', (tx, result) => {
        const request = tx.objectStore('previews').get(key);
        request.onsuccess = () => result(request.result?.value);
      });
    },
    putPreview(key, value) {
      return transaction<void>(['previews'], 'readwrite', tx => { tx.objectStore('previews').put({ key, value }); });
    },
    importLegacy(entries) {
      return transaction<void>(['generated', 'legacyGenerated'], 'readwrite', tx => {
        const generated = tx.objectStore('generated');
        const raw = tx.objectStore('legacyGenerated');
        for (const entry of entries) {
          // Keep unrecognized schemas as well as readable results. A future
          // migration can recover them; import never silently discards a record.
          raw.put({ key: entry.key, value: entry.value });
          if (entry.generated) {
            const value = entry.generated;
            const existing = generated.get(value.fingerprint);
            existing.onsuccess = () => {
              // A previous transfer may have committed before local cleanup
              // failed. Do not overwrite newer results when retrying that import.
              if (existing.result === undefined) generated.put(value);
            };
          }
        }
      });
    },
    clear() {
      return transaction<void>([...STORES], 'readwrite', tx => {
        for (const store of STORES) tx.objectStore(store).clear();
      });
    },
  };
}
