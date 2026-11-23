import React from 'react';
import { beforeEach, afterEach, describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ReloadPrompt from '../../../src/components/UI/ReloadPrompt';
import { useRegisterSW } from '../../../src/lib/pwaRegistration';
import * as pwaUpdateModule from '../../../src/lib/pwaUpdate';
import { setupReloadPromptTest, teardownReloadPromptTest, mockSetNeedRefresh, mockUpdateServiceWorker } from './reloadPromptTestFixture';

type RegistrationOptions = NonNullable<Parameters<typeof useRegisterSW>[0]>;

describe('service worker registration and visibility checks', () => {
  beforeEach(setupReloadPromptTest);
  afterEach(teardownReloadPromptTest);

  test('R1: Checks for service worker update when tab visibility changes to visible', async () => {
    const mockUpdate = vi.fn().mockResolvedValue(undefined);
    const mockGetRegistration = vi.fn().mockResolvedValue({
      update: mockUpdate,
    });

    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistration: mockGetRegistration,
      },
      writable: true,
      configurable: true,
    });

    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [false, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mockUpdateServiceWorker,
    });

    const { unmount } = render(<ReloadPrompt />);

    // Simulate tab becoming visible
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(mockGetRegistration).toHaveBeenCalledOnce();
    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockSetNeedRefresh).not.toHaveBeenCalled();

    unmount();
  });

  test('R1: a waiting worker on foreground restores the update prompt', async () => {
    const mockUpdate = vi.fn().mockResolvedValue(undefined);
    const mockGetRegistration = vi.fn().mockResolvedValue({
      update: mockUpdate,
      waiting: {},
    });

    Object.defineProperty(navigator, 'serviceWorker', {
      value: { getRegistration: mockGetRegistration },
      writable: true,
      configurable: true,
    });

    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [false, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mockUpdateServiceWorker,
    });

    const { unmount } = render(<ReloadPrompt />);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(mockSetNeedRefresh).toHaveBeenCalledWith(true);
    expect(mockUpdate).not.toHaveBeenCalled();
    unmount();
  });

  test('a registration update rejection does not announce or activate an unverified worker', async () => {
    const error = new Error('registration update unavailable');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    let onRegistered: RegistrationOptions['onRegisteredSW'];
    vi.mocked(useRegisterSW).mockImplementation(options => {
      onRegistered = options?.onRegisteredSW;
      return {
        needRefresh: [false, mockSetNeedRefresh],
        offlineReady: [false, vi.fn()],
        updateServiceWorker: mockUpdateServiceWorker,
      };
    });
    const registration = {
      waiting: null,
      installing: null,
      update: vi.fn().mockRejectedValue(error),
    } as unknown as ServiceWorkerRegistration;
    const view = render(<ReloadPrompt />);
    try {
      expect(onRegistered).toBeTypeOf('function');
      act(() => { onRegistered?.('/sw.js', registration); });
      await vi.waitFor(() => expect(log).toHaveBeenCalledWith('SW update error:', error));
      expect(registration.update).toHaveBeenCalledOnce();
      expect(mockSetNeedRefresh).not.toHaveBeenCalledWith(true);
      expect(pwaUpdateModule.applyPWAUpdate).not.toHaveBeenCalled();
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      view.unmount();
      log.mockRestore();
    }
  });

  test('R1: manual update waiting event restores the update prompt', () => {
    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [false, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mockUpdateServiceWorker,
    });

    const { unmount } = render(<ReloadPrompt />);
    act(() => {
      window.dispatchEvent(new Event('logbook:pwa-update-waiting'));
    });

    expect(mockSetNeedRefresh).toHaveBeenCalledWith(true);
    unmount();
  });

  test('dismissal prevents an older foreground registration check from reopening the update banner', async () => {
    let completeLookup!: (registration: ServiceWorkerRegistration) => void;
    const getRegistration = vi.fn(() => new Promise<ServiceWorkerRegistration>(resolve => { completeLookup = resolve; }));
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { getRegistration },
      configurable: true,
    });
    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [true, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mockUpdateServiceWorker,
    });

    const view = render(<ReloadPrompt />);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(getRegistration).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi notifica' }));

    const registration = { waiting: {}, update: vi.fn() } as unknown as ServiceWorkerRegistration;
    await act(async () => { completeLookup(registration); });
    expect(registration.update).not.toHaveBeenCalled();
    expect(mockSetNeedRefresh).toHaveBeenCalledWith(false);
    expect(mockSetNeedRefresh).not.toHaveBeenCalledWith(true);
    view.unmount();
  });

  test('a foreground worker check completing after unmount cannot update the removed prompt', async () => {
    let finishUpdate!: () => void;
    const registration = {
      waiting: null as ServiceWorker | null,
      installing: null,
      update: vi.fn(() => new Promise<void>(resolve => { finishUpdate = resolve; })),
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { getRegistration: vi.fn().mockResolvedValue(registration) },
      configurable: true,
    });
    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [false, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mockUpdateServiceWorker,
    });

    const view = render(<ReloadPrompt />);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    expect(registration.update).toHaveBeenCalledOnce();
    view.unmount();

    await act(async () => {
      registration.waiting = {} as ServiceWorker;
      finishUpdate();
    });
    expect(mockSetNeedRefresh).not.toHaveBeenCalledWith(true);
  });

  test('R1 Edge Case: Does NOT trigger update when visibility changes to hidden', async () => {
    const mockUpdate = vi.fn().mockResolvedValue(undefined);
    const mockGetRegistration = vi.fn().mockResolvedValue({
      update: mockUpdate,
    });

    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistration: mockGetRegistration,
      },
      writable: true,
      configurable: true,
    });

    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [false, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mockUpdateServiceWorker,
    });

    const { unmount } = render(<ReloadPrompt />);

    // Simulate tab becoming hidden
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(mockGetRegistration).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();

    unmount();
  });

  test('R1 Edge Case: Safely handles environment without navigator.serviceWorker', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [false, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mockUpdateServiceWorker,
    });

    const { unmount } = render(<ReloadPrompt />);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(mockUpdateServiceWorker).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();

    unmount();
  });

  test('closing the prompt invalidates a waiting registration check started before dismissal', async () => {
    let onRegistered: ((scriptUrl: string, registration: ServiceWorkerRegistration | undefined) => void) | undefined;
    vi.mocked(useRegisterSW).mockImplementation(options => {
      onRegistered = options?.onRegisteredSW;
      return { needRefresh: [true, mockSetNeedRefresh], offlineReady: [false, vi.fn()], updateServiceWorker: mockUpdateServiceWorker };
    });
    let finishUpdate!: () => void;
    const registration = {
      waiting: null as ServiceWorker | null,
      installing: null,
      update: vi.fn(() => new Promise<void>(resolve => {
        finishUpdate = () => {
          registration.waiting = { state: 'installed' } as ServiceWorker;
          resolve();
        };
      })),
    };
    const view = render(<ReloadPrompt />);
    act(() => { onRegistered?.('/sw.js', registration as unknown as ServiceWorkerRegistration); });
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi notifica' }));
    await act(async () => { finishUpdate(); });
    expect(mockSetNeedRefresh).toHaveBeenCalledWith(false);
    expect(mockSetNeedRefresh).not.toHaveBeenCalledWith(true);
    view.unmount();
  });

  test('registration exposes an already-waiting worker without activating or reloading it', async () => {
    let onRegistered: ((scriptUrl: string, registration: ServiceWorkerRegistration | undefined) => void) | undefined;
    vi.mocked(useRegisterSW).mockImplementation(options => {
      onRegistered = options?.onRegisteredSW;
      return { needRefresh: [false, mockSetNeedRefresh], offlineReady: [false, vi.fn()], updateServiceWorker: mockUpdateServiceWorker };
    });
    const view = render(<ReloadPrompt />);
    const registration = {
      waiting: { state: 'installed' },
      update: vi.fn().mockResolvedValue(undefined),
    } as unknown as ServiceWorkerRegistration;

    await act(async () => {
      onRegistered?.('/sw.js', registration);
      await Promise.resolve();
    });

    expect(mockSetNeedRefresh).toHaveBeenCalledExactlyOnceWith(true);
    expect(registration.update).not.toHaveBeenCalled();
    expect(pwaUpdateModule.applyPWAUpdate).not.toHaveBeenCalled();
    view.unmount();
  });

  test('periodic registration check reveals a worker that became waiting after the first check', async () => {
    vi.useFakeTimers();
    let onRegistered: ((scriptUrl: string, registration: ServiceWorkerRegistration | undefined) => void) | undefined;
    vi.mocked(useRegisterSW).mockImplementation(options => {
      onRegistered = options?.onRegisteredSW;
      return { needRefresh: [false, mockSetNeedRefresh], offlineReady: [false, vi.fn()], updateServiceWorker: mockUpdateServiceWorker };
    });
    const registration = {
      waiting: null as ServiceWorker | null,
      installing: null,
      update: vi.fn(async () => {
        if (registration.update.mock.calls.length === 2) {
          registration.waiting = { state: 'installed' } as ServiceWorker;
        }
      }),
    };
    const view = render(<ReloadPrompt />);
    try {
      await act(async () => { onRegistered?.('/sw.js', registration as unknown as ServiceWorkerRegistration); await Promise.resolve(); });
      expect(mockSetNeedRefresh).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(60 * 60 * 1000); });
      expect(registration.update).toHaveBeenCalledTimes(2);
      expect(mockSetNeedRefresh).toHaveBeenCalledExactlyOnceWith(true);
      expect(pwaUpdateModule.applyPWAUpdate).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  test('an outstanding registration check cannot reopen the prompt after unmount', async () => {
    let onRegistered: ((scriptUrl: string, registration: ServiceWorkerRegistration | undefined) => void) | undefined;
    vi.mocked(useRegisterSW).mockImplementation(options => {
      onRegistered = options?.onRegisteredSW;
      return { needRefresh: [false, mockSetNeedRefresh], offlineReady: [false, vi.fn()], updateServiceWorker: mockUpdateServiceWorker };
    });
    let finishUpdate!: () => void;
    const registration = {
      waiting: null as ServiceWorker | null,
      installing: null,
      update: vi.fn(() => new Promise<void>(resolve => {
        finishUpdate = () => {
          registration.waiting = { state: 'installed' } as ServiceWorker;
          resolve();
        };
      })),
    };
    const view = render(<ReloadPrompt />);
    act(() => { onRegistered?.('/sw.js', registration as unknown as ServiceWorkerRegistration); });
    view.unmount();
    await act(async () => { finishUpdate(); });
    expect(mockSetNeedRefresh).not.toHaveBeenCalled();
  });

  test('a foreground check does not publish a waiting result after the tab becomes hidden', async () => {
    let finishLookup!: (registration: ServiceWorkerRegistration) => void;
    const lookup = vi.fn(() => new Promise<ServiceWorkerRegistration>(resolve => { finishLookup = resolve; }));
    const registration = {
      waiting: { state: 'installed' },
      update: vi.fn(),
    } as unknown as ServiceWorkerRegistration;
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { getRegistration: lookup }, writable: true, configurable: true,
    });
    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [false, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mockUpdateServiceWorker,
    });
    const view = render(<ReloadPrompt />);
    try {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      expect(lookup).toHaveBeenCalledOnce();
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      await act(async () => { finishLookup(registration); });
      expect(registration.update).not.toHaveBeenCalled();
      expect(mockSetNeedRefresh).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  test('R1: onRegistered checks immediately, keeps the periodic timer and handles errors gracefully', () => {
    vi.useFakeTimers();
    let registeredCallback: RegistrationOptions['onRegisteredSW'];
    let registerErrorCallback: RegistrationOptions['onRegisterError'];

    vi.mocked(useRegisterSW).mockImplementation((options) => {
      registeredCallback = options?.onRegisteredSW;
      registerErrorCallback = options?.onRegisterError;
      return {
        needRefresh: [false, mockSetNeedRefresh],
        offlineReady: [false, vi.fn()],
        updateServiceWorker: mockUpdateServiceWorker,
      };
    });

    const { unmount } = render(<ReloadPrompt />);

    expect(registeredCallback).toBeDefined();
    expect(registerErrorCallback).toBeDefined();

    const mockRegistration = {
      waiting: null,
      installing: null,
      update: vi.fn().mockResolvedValue(undefined),
    } as unknown as ServiceWorkerRegistration;

    // Trigger onRegisteredSW
    act(() => {
      registeredCallback!('/sw.js', mockRegistration);
    });

    // Registration performs an immediate check.
    expect(mockRegistration.update).toHaveBeenCalledTimes(1);

    // Advance 60 minutes for the fallback periodic check.
    act(() => {
      vi.advanceTimersByTime(60 * 60 * 1000);
    });

    expect(mockRegistration.update).toHaveBeenCalledTimes(2);

    // Trigger onRegisterError
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    act(() => {
      registerErrorCallback!(new Error('Test SW error'));
    });
    expect(consoleSpy).toHaveBeenCalledWith('SW registration error:', expect.any(Error));
    consoleSpy.mockRestore();

    unmount();
    vi.useRealTimers();
  });
});
