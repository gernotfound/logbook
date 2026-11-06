import React, { StrictMode } from 'react';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSW } from 'virtual:pwa-register';
import type { RegisterSWOptions } from 'virtual:pwa-register';
import { useRegisterSW } from '../src/lib/pwaRegistration';
import ReloadPrompt from '../src/components/UI/ReloadPrompt';

// Exercise the production adapter; only the external Workbox entry is mocked.
vi.unmock('../src/lib/pwaRegistration');
vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn() }));

function registrationOptions(): RegisterSWOptions {
  const options = vi.mocked(registerSW).mock.calls.at(-1)?.[0];
  if (!options) throw new Error('The production adapter did not register');
  return options;
}

describe('PWA registration adapter', () => {
  beforeEach(() => {
    vi.mocked(registerSW).mockReset();
    vi.mocked(registerSW).mockReturnValue(vi.fn(async () => undefined));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('registers once through StrictMode replay and keeps live state callbacks after rerenders', () => {
    const onNeedRefresh = vi.fn();
    const onOfflineReady = vi.fn();
    const { result, rerender } = renderHook(
      () => useRegisterSW({ onNeedRefresh, onOfflineReady }),
      { wrapper: ({ children }) => <StrictMode>{children}</StrictMode> },
    );
    const update = result.current.updateServiceWorker;
    const setNeedRefresh = result.current.needRefresh[1];
    const options = registrationOptions();
    expect(registerSW).toHaveBeenCalledOnce();
    expect(options.immediate).toBe(true);
    expect(result.current.needRefresh[0]).toBe(false);
    expect(result.current.offlineReady[0]).toBe(false);

    act(() => {
      options.onNeedRefresh?.();
      options.onOfflineReady?.();
    });
    expect(result.current.needRefresh[0]).toBe(true);
    expect(result.current.offlineReady[0]).toBe(true);
    expect(onNeedRefresh).toHaveBeenCalledOnce();
    expect(onOfflineReady).toHaveBeenCalledOnce();

    act(() => setNeedRefresh(false));
    rerender();
    expect(result.current.needRefresh[0]).toBe(false);
    expect(result.current.needRefresh[1]).toBe(setNeedRefresh);
    expect(result.current.updateServiceWorker).toBe(update);
    expect(registerSW).toHaveBeenCalledOnce();
  });

  it('forwards registration results, errors and explicit registration options', () => {
    const onRegisteredSW = vi.fn();
    const onRegisterError = vi.fn();
    const { unmount } = renderHook(() => useRegisterSW({
      immediate: false, updateViaCache: 'none', onRegisteredSW, onRegisterError,
    }));
    const options = registrationOptions();
    expect(options.immediate).toBe(false);
    expect(options.updateViaCache).toBe('none');

    const registration = { update: vi.fn() } as unknown as ServiceWorkerRegistration;
    const error = new Error('Registration unavailable');
    act(() => {
      options.onRegisteredSW?.('/sw.js', registration);
      options.onRegisteredSW?.('/sw.js', undefined);
      options.onRegisterError?.(error);
    });
    expect(onRegisteredSW.mock.calls).toEqual([['/sw.js', registration], ['/sw.js', undefined]]);
    expect(onRegisterError).toHaveBeenCalledExactlyOnceWith(error);
    unmount();
  });

  it('always supplies a reload override and drops callbacks after unmount', () => {
    const onNeedRefresh = vi.fn();
    const onOfflineReady = vi.fn();
    const onRegisteredSW = vi.fn();
    const onRegisterError = vi.fn();
    const onNeedReload = vi.fn();
    const view = renderHook(() => useRegisterSW({
      onNeedRefresh, onOfflineReady, onRegisteredSW, onRegisterError, onNeedReload,
    }));
    const options = registrationOptions();
    act(() => options.onNeedReload?.());
    expect(onNeedReload).toHaveBeenCalledOnce();
    onNeedReload.mockClear();
    view.unmount();

    act(() => {
      options.onNeedRefresh?.();
      options.onOfflineReady?.();
      options.onRegisteredSW?.('/sw.js', undefined);
      options.onRegisterError?.(new Error('Late registration failure'));
      options.onNeedReload?.();
    });
    for (const callback of [onNeedRefresh, onOfflineReady, onRegisteredSW, onRegisterError, onNeedReload]) {
      expect(callback).not.toHaveBeenCalled();
    }

    const defaultView = renderHook(() => useRegisterSW());
    // The upstream entry reloads automatically when this callback is absent.
    expect(registrationOptions().onNeedReload).toBeTypeOf('function');
    expect(registrationOptions().onNeedReload?.()).toBeUndefined();
    defaultView.unmount();
  });

  it('drives the real update prompt and clears its periodic check on unmount', async () => {
    vi.useFakeTimers();
    const registration = { update: vi.fn(async () => undefined) } as unknown as ServiceWorkerRegistration;
    const view = render(<StrictMode><ReloadPrompt /></StrictMode>);
    const options = registrationOptions();
    expect(registerSW).toHaveBeenCalledOnce();

    await act(async () => options.onRegisteredSW?.('/sw.js', registration));
    expect(registration.update).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 60 * 1000); });
    expect(registration.update).toHaveBeenCalledTimes(2);
    act(() => options.onNeedRefresh?.());
    expect(screen.getByText('Nuova versione disponibile')).toBeDefined();

    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 60 * 1000); });
    expect(registration.update).toHaveBeenCalledTimes(2);
  });

  it('does not recreate a cleaned update timer when registration finishes after unmount', async () => {
    vi.useFakeTimers();
    const registration = { update: vi.fn(async () => undefined) } as unknown as ServiceWorkerRegistration;
    const view = render(<ReloadPrompt />);
    const options = registrationOptions();
    view.unmount();

    // registerSW delivers this asynchronously after Workbox.register resolves.
    await act(async () => options.onRegisteredSW?.('/sw.js', registration));
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 60 * 1000); });
    expect(registration.update).not.toHaveBeenCalled();
  });
});
