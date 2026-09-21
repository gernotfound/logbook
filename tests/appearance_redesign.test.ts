import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const key = 'logbook:appearance:v1';
const bootstrap = readFileSync(resolve('public/appearance.js'), 'utf8');
let stop: (() => void) | undefined;
let dark = false;
let listeners: Set<() => void>;

beforeEach(() => {
  vi.resetModules();
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
    clear: vi.fn(() => values.clear()),
  });
  dark = false;
  listeners = new Set();
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    get matches() { return dark; },
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  })));
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-theme-preference');
  document.head.innerHTML = '<meta name="theme-color" content="#000000">';
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function runBootstrap() {
  runInNewContext(bootstrap, { window, document, localStorage });
}
function systemChangesTo(value: boolean) {
  dark = value;
  listeners.forEach(listener => listener());
}

describe('local appearance preference', () => {
  it('applies the saved preference before React and keeps it on initialization', async () => {
    dark = true;
    localStorage.setItem(key, 'light');
    runBootstrap();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#f3f4f6');
    const { initializeAppearance, useAppearanceStore } = await import('../src/store/useAppearanceStore');
    stop = initializeAppearance();
    expect(useAppearanceStore.getState()).toMatchObject({ preference: 'light', resolvedTheme: 'light' });
    systemChangesTo(false);
    systemChangesTo(true);
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('follows system changes only in system mode and removes listeners on disposal', async () => {
    localStorage.setItem(key, 'invalid');
    runBootstrap();
    expect(document.documentElement.dataset.themePreference).toBe('system');
    const { initializeAppearance, useAppearanceStore } = await import('../src/store/useAppearanceStore');
    stop = initializeAppearance();
    expect(initializeAppearance()).toBe(stop);
    expect(listeners.size).toBe(1);
    systemChangesTo(true);
    expect(document.documentElement.dataset.theme).toBe('dark');
    useAppearanceStore.getState().setPreference('light');
    systemChangesTo(false);
    systemChangesTo(true);
    expect(document.documentElement.dataset.theme).toBe('light');
    useAppearanceStore.getState().setPreference('system');
    expect(document.documentElement.dataset.theme).toBe('dark');
    stop();
    expect(listeners.size).toBe(0);
    systemChangesTo(false);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('applies a choice while reporting that unavailable storage cannot persist it', async () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    dark = true;
    expect(runBootstrap).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('dark');
    const { initializeAppearance, useAppearanceStore } = await import('../src/store/useAppearanceStore');
    stop = initializeAppearance();
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(useAppearanceStore.getState().setPreference('light')).toBe(false);
    expect(useAppearanceStore.getState()).toMatchObject({ preference: 'light', resolvedTheme: 'light' });
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('syncs the device preference across tabs without touching other storage keys', async () => {
    const { initializeAppearance, useAppearanceStore } = await import('../src/store/useAppearanceStore');
    stop = initializeAppearance();
    const write = vi.spyOn(localStorage, 'setItem');
    write.mockClear();
    expect(useAppearanceStore.getState().setPreference('dark')).toBe(true);
    expect(write.mock.calls).toEqual([[key, 'dark']]);
    window.dispatchEvent(new StorageEvent('storage', { key: 'logbook:other', newValue: 'light' }));
    expect(useAppearanceStore.getState().preference).toBe('dark');
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: 'light' }));
    expect(useAppearanceStore.getState()).toMatchObject({ preference: 'light', resolvedTheme: 'light' });
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: null }));
    expect(useAppearanceStore.getState().preference).toBe('system');
  });

  it('starts safely when the system-theme API is absent', async () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(runBootstrap).not.toThrow();
    const { initializeAppearance, useAppearanceStore } = await import('../src/store/useAppearanceStore');
    stop = initializeAppearance();
    expect(useAppearanceStore.getState()).toMatchObject({ preference: 'system', resolvedTheme: 'light' });
  });
});
