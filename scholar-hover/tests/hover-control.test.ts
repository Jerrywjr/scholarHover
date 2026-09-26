import { describe, expect, it, vi } from 'vitest';
import { createHoverControl } from '../src/background/hover-control';

function setup() {
  let stored = false;
  let granted = false;
  let registered = false;
  const calls: string[] = [];
  const deps = {
    read: async () => stored,
    write: async (value: boolean) => { stored = value; calls.push(`store:${value}`); },
    hasAccess: async () => granted,
    isRegistered: async () => registered,
    register: async () => { registered = true; calls.push('register'); },
    unregister: async () => { registered = false; calls.push('unregister'); },
    inject: async () => { calls.push('inject'); },
    notify: async (enabled: boolean) => { calls.push(`notify:${enabled}`); },
    badge: async (enabled: boolean) => { calls.push(`badge:${enabled}`); },
  };
  return { deps, calls, control: createHoverControl(deps), grant: (value = true) => { granted = value; }, saved: () => stored, registered: () => registered };
}

describe('global hover switch', () => {
  it('starts off and does not register or inject before explicit activation', async () => {
    const s = setup();
    await s.control.sync();
    expect(await s.control.get()).toEqual({ enabled: false, hasAccess: false });
    expect(s.registered()).toBe(false);
    expect(s.calls).not.toContain('inject');
  });
  it('requires permission before enabling and keeps off if registration fails', async () => {
    const s = setup();
    await expect(s.control.set(true)).rejects.toThrow();
    expect(s.saved()).toBe(false);
    s.grant();
    s.deps.register = async () => { throw new Error('Registration failed'); };
    await expect(s.control.set(true)).rejects.toThrow('Registration failed');
    expect(s.saved()).toBe(false);
  });
  it('enables existing pages only after persisting the switch and registering future pages', async () => {
    const s = setup(); s.grant();
    expect(await s.control.set(true)).toEqual({ enabled: true, hasAccess: true });
    expect(s.calls).toEqual(['register', 'store:true', 'inject', 'notify:true', 'badge:true']);
    expect(s.registered()).toBe(true);
    await s.control.sync();
    expect(s.calls.filter(x => x === 'inject')).toHaveLength(1);
    expect(s.calls.filter(x => x === 'register')).toHaveLength(1);
  });
  it('disables open pages and future injection without revoking model/source permissions', async () => {
    const s = setup(); s.grant(); await s.control.set(true); s.calls.length = 0;
    expect(await s.control.set(false)).toEqual({ enabled: false, hasAccess: true });
    expect(s.calls).toEqual(['store:false', 'unregister', 'notify:false', 'badge:false']);
    expect(s.registered()).toBe(false);
  });
  it('recovers safely when host permission is revoked while enabled', async () => {
    const s = setup(); s.grant(); await s.control.set(true); s.grant(false);
    await s.control.sync();
    expect(s.saved()).toBe(false);
    expect(s.registered()).toBe(false);
    expect(s.calls).toContain('notify:false');
    s.grant();
    expect((await s.control.get()).enabled).toBe(false);
  });
  it('serializes rapid switch changes so the final off state wins', async () => {
    const s = setup(); s.grant();
    await Promise.all([s.control.set(true), s.control.set(false)]);
    expect(s.saved()).toBe(false);
    expect(s.registered()).toBe(false);
    expect(s.calls.at(-2)).toBe('notify:false');
  });
  it('reports off and notifies pages even if unregister temporarily fails', async () => {
    const s = setup(); s.grant(); await s.control.set(true);
    s.deps.unregister = vi.fn(async () => { throw new Error('Worker shutting down'); });
    await expect(s.control.set(false)).rejects.toThrow();
    expect(s.saved()).toBe(false);
    expect((await s.control.get()).enabled).toBe(false);
    expect(s.calls.at(-2)).toBe('notify:false');
  });
});
