import { vi } from 'vitest';

type Values = Record<string, unknown>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function installChromeStorage(initialLocal: Values = {}, initialSession: Values = {}) {
  const local = clone(initialLocal);
  const session = clone(initialSession);
  const accessLevels: string[] = [];

  function area(values: Values) {
    return {
      get: vi.fn(async (keys?: string | string[] | null) => {
        if (keys === null || keys === undefined) return clone(values);
        const names = typeof keys === 'string' ? [keys] : keys;
        return Object.fromEntries(names.filter((key) => key in values).map((key) => [key, clone(values[key])]));
      }),
      set: vi.fn(async (updates: Values) => Object.assign(values, clone(updates))),
      remove: vi.fn(async (keys: string | string[]) => {
        for (const key of (typeof keys === 'string' ? [keys] : keys)) delete values[key];
      }),
      clear: vi.fn(async () => {
        for (const key of Object.keys(values)) delete values[key];
      }),
      setAccessLevel: vi.fn(async ({ accessLevel }: { accessLevel: string }) => accessLevels.push(accessLevel)),
    };
  }

  const chromeMock = { storage: { local: area(local), session: area(session) } };
  vi.stubGlobal('chrome', chromeMock);
  return { local, session, accessLevels, chromeMock };
}
