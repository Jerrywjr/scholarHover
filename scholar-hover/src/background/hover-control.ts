import type { HoverState } from '../shared/types';
export interface HoverControlDependencies {
  read(): Promise<boolean>;
  write(enabled: boolean): Promise<void>;
  hasAccess(): Promise<boolean>;
  isRegistered(): Promise<boolean>;
  register(): Promise<void>;
  unregister(): Promise<void>;
  inject(): Promise<void>;
  notify(enabled: boolean): Promise<void>;
  badge(enabled: boolean): Promise<void>;
}
export function createHoverControl(deps: HoverControlDependencies) {
  let queue = Promise.resolve();
  function serial<T>(action: () => Promise<T>): Promise<T> {
    const result = queue.then(action, action);
    queue = result.then(() => {}, () => {});
    return result;
  }
  async function get(): Promise<HoverState> {
    const [enabled, hasAccess] = await Promise.all([deps.read(), deps.hasAccess()]);
    return { enabled: enabled && hasAccess, hasAccess };
  }
  async function stop() {
    await deps.write(false);
    try { if (await deps.isRegistered()) await deps.unregister(); }
    finally { await deps.notify(false); await deps.badge(false); }
  }
  return {
    get,
    set(enabled: boolean): Promise<HoverState> {
      return serial(async () => {
        if (enabled) {
          if (!await deps.hasAccess()) throw new Error('请先授予 HTTPS 网站访问权限。');
          if (!await deps.isRegistered()) await deps.register();
          await deps.write(true);
          await deps.inject();
          await deps.notify(true);
          await deps.badge(true);
        } else await stop();
        return get();
      });
    },
    sync(): Promise<void> {
      return serial(async () => {
        const state = await get();
        if (!state.enabled) {
          if (await deps.read() || await deps.isRegistered()) await stop();
          else await deps.badge(false);
          return;
        }
        if (!await deps.isRegistered()) await deps.register();
        await deps.badge(true);
      });
    },
  };
}
