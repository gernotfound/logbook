import React from 'react';
import type { UserData, WorkoutSession } from '../src/types';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import ReloadPrompt from '../src/components/UI/ReloadPrompt';
import { useRegisterSW } from 'virtual:pwa-register/react';
import App from '../src/App';
import { idbStore, localStorageMock, mockFirebaseAuth, renderWithProviders } from './setup';
import { prepareUnlockedTestArchive } from './secureVaultFixture';
import { initializeLocal } from '../src/lib/sync/localRepository';
import { vaultControlKey } from '../src/lib/sync/secureArchiveSession';
import { UserDataSchema } from '../src/lib/schema';
import { useAppStore } from '../src/store/useAppStore';
import { BufferedInput } from '../src/components/UI/BufferedInput';
import { invalidateSession } from '../src/lib/sync/session';
import * as pwaUpdateModule from '../src/lib/pwaUpdate';
import * as reloadBarrierModule from '../src/lib/sync/reloadBarrier';

describe('Service Worker Update Lifecycle (ReloadPrompt) Suite', () => {
  let mockSetNeedRefresh = vi.fn<(value: React.SetStateAction<boolean>) => void>();
  let mockUpdateServiceWorker = vi.fn<(reloadPage?: boolean) => Promise<void>>();
  const originalServiceWorker = navigator.serviceWorker;
  const originalStorageGetItem = localStorageMock.getItem.getMockImplementation()!;

  beforeEach(() => {
    localStorageMock.getItem.mockImplementation(originalStorageGetItem);
    useAppStore.getState().resetStore();
    mockSetNeedRefresh = vi.fn<(value: React.SetStateAction<boolean>) => void>();
    mockUpdateServiceWorker = vi.fn<(reloadPage?: boolean) => Promise<void>>().mockResolvedValue(undefined);
    vi.clearAllMocks();
    vi.spyOn(pwaUpdateModule, 'applyPWAUpdate').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(navigator, 'serviceWorker', {
      value: originalServiceWorker,
      writable: true,
      configurable: true,
    });
  });

  test('R1: ReloadPrompt does not render anything when needRefresh is false', () => {
    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [false, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mockUpdateServiceWorker,
    });

    const { container } = render(<ReloadPrompt />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText(/Nuova versione disponibile/i)).toBeNull();
  });

  test('a chunk failure opens a dismissible prompt instead of reloading automatically', () => {
    vi.mocked(useRegisterSW).mockReturnValue({ needRefresh: [false, mockSetNeedRefresh], offlineReady: [false, vi.fn()], updateServiceWorker: mockUpdateServiceWorker });
    render(<ReloadPrompt />);
    const event = new Event('vite:preloadError', { cancelable: true });
    act(() => { window.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByText('Aggiornamento richiesto per caricare questa schermata')).toBeDefined();
    expect(mockUpdateServiceWorker).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Chiudi/i }));
    expect(screen.queryByText('Aggiornamento richiesto per caricare questa schermata')).toBeNull();
  });

  test('a chunk failure verifies local data and activates the new worker via the same update path', async () => {
    await prepareUnlockedTestArchive('user:test-user-id');
    const barrier = vi.spyOn(reloadBarrierModule, 'prepareForReload');
    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [false, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mockUpdateServiceWorker,
    });
    render(<ReloadPrompt />);
    act(() => { window.dispatchEvent(new Event('vite:preloadError', { cancelable: true })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Aggiorna/i })); });
    expect(barrier).toHaveBeenCalledOnce();
    expect(pwaUpdateModule.applyPWAUpdate).toHaveBeenCalledOnce();
    expect(mockUpdateServiceWorker).not.toHaveBeenCalled();
  });

  test('never activates an update when an existing encrypted archive loses its vault control', async () => {
    const owner = 'user:test-user-id';
    await prepareUnlockedTestArchive(owner);
    const userData = UserDataSchema.parse({ profile: { height: '181' } }) as unknown as UserData;
    await initializeLocal(owner, userData);
    const storageKey = 'logbook:v2:' + owner;
    const preservedCiphertext = idbStore[storageKey] as string;
    expect(preservedCiphertext).toMatch(/^tlb-sealed:v1:/);

    // Simulate a lost control record without removing the owner's ciphertext.
    localStorage.removeItem(vaultControlKey(owner));
    useAppStore.setState({
      userData, dataOwner: owner, localWorkout: null,
      syncing: false, localPersistenceBlocked: false,
    });
    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [true, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mockUpdateServiceWorker,
    });
    render(<ReloadPrompt />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Aggiorna applicazione/i }));
    });

    expect(screen.getByText(/Archivio protetto non pronto/i)).toBeDefined();
    expect(pwaUpdateModule.applyPWAUpdate).not.toHaveBeenCalled();
    expect(mockUpdateServiceWorker).not.toHaveBeenCalled();
    expect(idbStore[storageKey]).toBe(preservedCiphertext);
  });

  test('a rejected chunk-failure reload barrier keeps the update prompt visible', async () => {
    vi.spyOn(reloadBarrierModule, 'prepareForReload').mockRejectedValueOnce(new Error('Ultime modifiche non salvate'));
    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [false, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mockUpdateServiceWorker,
    });
    render(<ReloadPrompt />);
    act(() => { window.dispatchEvent(new Event('vite:preloadError', { cancelable: true })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Aggiorna/i })); });
    expect(screen.getByText('Ultime modifiche non salvate')).toBeDefined();
    expect(screen.getByText('Aggiornamento richiesto per caricare questa schermata')).toBeDefined();
    expect(pwaUpdateModule.applyPWAUpdate).not.toHaveBeenCalled();
    expect(mockUpdateServiceWorker).not.toHaveBeenCalled();
  });

  test('unmount flushes a buffered input only in its original session', () => {
    const update = vi.fn();
    const first = render(<BufferedInput value="" onChange={update} aria-label="Bozza" />);
    fireEvent.change(screen.getByLabelText('Bozza'), { target: { value: '7,5' } });
    first.unmount();
    expect(update).toHaveBeenCalledExactlyOnceWith('7,5');
    update.mockClear();
    const second = render(<BufferedInput value="" onChange={update} aria-label="Bozza" />);
    fireEvent.change(screen.getByLabelText('Bozza'), { target: { value: 'private' } });
    invalidateSession(); second.unmount();
    expect(update).not.toHaveBeenCalled();
  });

  test('rerendering a buffered input does not repeat strict owner storage reads', () => {
    const update = vi.fn();
    const view = render(<BufferedInput id="stable-session-draft" value="" onChange={update} aria-label="Stable" />);
    useAppStore.setState({ localPersistenceBlocked: false, saveError: null });
    localStorageMock.getItem.mockImplementation(() => { throw new Error('storage unavailable after mount'); });

    expect(() => view.rerender(
      <BufferedInput id="stable-session-draft" value="remote" onChange={update} aria-label="Stable" />,
    )).not.toThrow();
    expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
    view.unmount();
  });

  test('a dirty buffered field leaves an owner-scoped recovery copy before session invalidation', () => {
    const update = vi.fn();
    const { unmount } = render(<BufferedInput id="recoverable-draft" value="" onChange={update} aria-label="Recoverable" />);
    fireEvent.change(screen.getByLabelText('Recoverable'), { target: { value: '82,5' } });
    expect([...Array(localStorage.length)].map((_, index) => localStorage.key(index))
      .some(key => key?.endsWith(':draft:buffered:input:recoverable-draft'))).toBe(true);
    invalidateSession();
    unmount();
    expect(update).not.toHaveBeenCalled();
  });

  test('R1 & R2: ReloadPrompt renders non-invasive dark glassmorphic banner when needRefresh is true', () => {
    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [true, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mockUpdateServiceWorker,
    });

    render(<ReloadPrompt />);

    // Check alert role for accessibility
    const alertElement = screen.getByRole('alert');
    expect(alertElement).toBeDefined();
    expect(alertElement.className).toContain('reload-prompt-toast');

    // Verify Sentence case typography and message
    expect(screen.getByText('Nuova versione disponibile')).toBeDefined();

    // Verify buttons exist
    const updateBtn = screen.getByRole('button', { name: /Aggiorna/i });
    const closeBtn = screen.getByRole('button', { name: /Chiudi/i });
    expect(updateBtn).toBeDefined();
    expect(closeBtn).toBeDefined();
  });

  test('R2: Clicking "Aggiorna" uses the explicit SW activation and durable reload path', async () => {
    await prepareUnlockedTestArchive('user:test-user-id');
    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [true, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mockUpdateServiceWorker,
    });

    render(<ReloadPrompt />);

    const updateBtn = screen.getByRole('button', { name: /Aggiorna/i });
    await act(async () => {
      fireEvent.click(updateBtn);
    });

    expect(pwaUpdateModule.applyPWAUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdateServiceWorker).not.toHaveBeenCalled();
  });

  test('updates from the login screen without reporting a changed guest session', async () => {
    mockFirebaseAuth.currentUser = null;
    useAppStore.setState({ userData: null, dataOwner: null, localWorkout: null, syncing: false, localPersistenceBlocked: false });
    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [true, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mockUpdateServiceWorker,
    });

    render(<ReloadPrompt />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Aggiorna/i }));
    });

    expect(pwaUpdateModule.applyPWAUpdate).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Sessione cambiata/i)).toBeNull();
  });

  test('a failed durable reload barrier never attempts worker activation', async () => {
    vi.spyOn(reloadBarrierModule, 'prepareForReload').mockRejectedValueOnce(new Error('Bozza non salvata'));
    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [true, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mockUpdateServiceWorker,
    });
    render(<ReloadPrompt />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Aggiorna/i })); });
    expect(screen.getByText('Bozza non salvata')).toBeDefined();
    expect(pwaUpdateModule.applyPWAUpdate).not.toHaveBeenCalled();
  });

  test('Workbox controlling events cannot bypass the explicit safe reload path', () => {
    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [true, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mockUpdateServiceWorker,
    });
    render(<ReloadPrompt />);
    const options = vi.mocked(useRegisterSW).mock.calls.at(-1)?.[0];
    expect(options?.onNeedReload).toBeTypeOf('function');
    options?.onNeedReload?.();
    expect(pwaUpdateModule.applyPWAUpdate).not.toHaveBeenCalled();
    expect(mockUpdateServiceWorker).not.toHaveBeenCalled();
  });

  test('slow worker activation offers cancellation without a false failure', async () => {
    await prepareUnlockedTestArchive('user:test-user-id');
    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [true, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mockUpdateServiceWorker,
    });
    let wasAborted = false;
    vi.spyOn(pwaUpdateModule, 'applyPWAUpdate').mockImplementation((_container, _reload, _timeout, options) =>
      new Promise<void>((_resolve, reject) => {
        options?.onActivationDelayed?.();
        options?.signal?.addEventListener('abort', () => {
          wasAborted = true;
          reject(new DOMException('Aggiornamento annullato.', 'AbortError'));
        }, { once: true });
      }),
    );
    render(<ReloadPrompt />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Aggiorna applicazione/i }));
    });
    expect(screen.getByText(/Il browser sta impiegando più tempo/i)).toBeDefined();
    expect(screen.queryByText(/non confermata/i)).toBeNull();
    const close = screen.getByRole('button', { name: /Chiudi notifica/i }) as HTMLButtonElement;
    expect(close.disabled).toBe(false);
    await act(async () => { fireEvent.click(close); });
    expect(wasAborted).toBe(true);
    // This hook is mocked with a spy, not a stateful React setter.
    expect(mockSetNeedRefresh).toHaveBeenCalledWith(false);
    expect(mockUpdateServiceWorker).not.toHaveBeenCalled();
  });

  test('revalidates local data immediately before navigating after activation', async () => {
    mockFirebaseAuth.currentUser = null;
    useAppStore.setState({ userData: null, dataOwner: null, localWorkout: null, syncing: false, localPersistenceBlocked: false });
    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [true, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mockUpdateServiceWorker,
    });
    const originalPrepare = reloadBarrierModule.prepareForReload;
    const barrier = vi.spyOn(reloadBarrierModule, 'prepareForReload')
      .mockImplementationOnce(() => originalPrepare())
      .mockRejectedValueOnce(new Error('Bozza modificata durante l’attivazione'));
    vi.spyOn(pwaUpdateModule, 'applyPWAUpdate').mockImplementation(async (_container, reload) => {
      await reload();
    });
    render(<ReloadPrompt />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Aggiorna applicazione/i }));
    });
    expect(barrier).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Bozza modificata durante l’attivazione')).toBeDefined();
  });

  test('R2: Clicking "Chiudi" button dismisses prompt via setNeedRefresh(false)', () => {
    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [true, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mockUpdateServiceWorker,
    });

    render(<ReloadPrompt />);

    const closeBtn = screen.getByRole('button', { name: /Chiudi/i });
    act(() => {
      fireEvent.click(closeBtn);
    });

    expect(mockSetNeedRefresh).toHaveBeenCalledWith(false);
  });

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

    expect(mockGetRegistration).toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalled();

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

  test('R1: onRegistered checks immediately, keeps the periodic timer and handles errors gracefully', () => {
    vi.useFakeTimers();
    let registeredCallback: ((r: any) => void) | undefined;
    let registerErrorCallback: ((error: any) => void) | undefined;

    vi.mocked(useRegisterSW).mockImplementation((options) => {
      registeredCallback = options?.onRegistered;
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
      update: vi.fn().mockResolvedValue(undefined),
    };

    // Trigger onRegistered
    act(() => {
      registeredCallback!(mockRegistration);
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

  test('R3: the global ReloadPrompt coexists with App and renders the update banner', async () => {
    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [true, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mockUpdateServiceWorker,
    });

    const { container } = renderWithProviders(<><ReloadPrompt /><App /></>);
    expect(container).toBeDefined();

    // Verify the root-level prompt is independent from App early-return states
    expect(screen.getByText('Nuova versione disponibile')).toBeDefined();
    expect(screen.getByRole('button', { name: /Aggiorna/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Chiudi/i })).toBeDefined();
  });

  test('Rule 8 & UX: Active workout session state and input responsiveness are not interrupted when ReloadPrompt appears', () => {
    const mockActiveWorkout: WorkoutSession = {
      routineId: 'r1',
      routineName: 'Scheda A - Upper',
      globalStartTime: Date.now(),
      exercises: [
        {
          exId: 'ex1',
          sessionNote: '',
          sets: [{ id: 's1', kg: '80', reps: '10', done: false }]
        }
      ]
    };

    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [true, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mockUpdateServiceWorker,
    });

    const bufferedChange = vi.fn();
    renderWithProviders(<><ReloadPrompt /><App /><BufferedInput value="" onChange={bufferedChange} aria-label="Serie attiva" /></>, { localWorkout: mockActiveWorkout });

    // Verify workout is still preserved in store and active in memory
    const state = useAppStore.getState();
    expect(state.localWorkout).toEqual(mockActiveWorkout);
    expect(state.localWorkout?.exercises[0].exId).toBe('ex1');

    // Both ReloadPrompt banner and workout UI exist concurrently
    expect(screen.getByText('Nuova versione disponibile')).toBeDefined();
    expect(screen.getByRole('button', { name: /Aggiorna/i })).toBeDefined();
    const field = screen.getByRole('textbox', { name: 'Serie attiva' }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: '82,5' } });
    expect(field.value).toBe('82,5');
    expect(useAppStore.getState().localWorkout).toEqual(mockActiveWorkout);
    expect(mockUpdateServiceWorker).not.toHaveBeenCalled();
  });

  test('Edge Case: shows an activation rejection without reloading or hiding the prompt', async () => {
    await prepareUnlockedTestArchive('user:test-user-id');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const rejectingUpdate = vi.spyOn(pwaUpdateModule, 'applyPWAUpdate')
      .mockRejectedValue(new Error('Failed to postMessage to SW'));

    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [true, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mockUpdateServiceWorker,
    });

    render(<ReloadPrompt />);

    const updateBtn = screen.getByRole('button', { name: /Aggiorna/i });
    await act(async () => {
      fireEvent.click(updateBtn);
    });

    expect(rejectingUpdate).toHaveBeenCalledOnce();
    expect(screen.getByText('Failed to postMessage to SW')).toBeDefined();
    consoleSpy.mockRestore();
  });

  test('Edge Case: Handles navigator.serviceWorker.getRegistration() promise rejection on visibilitychange', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mockGetRegistration = vi.fn().mockRejectedValue(new Error('Security error'));

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

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(mockGetRegistration).toHaveBeenCalled();
    // The rejected registration lookup is contained by the production handler.

    unmount();
    consoleSpy.mockRestore();
  });

  test('Edge Case: Periodic timer handles SW registration update rejection gracefully', async () => {
    vi.useFakeTimers();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    let registeredCallback: ((r: any) => void) | undefined;

    vi.mocked(useRegisterSW).mockImplementation((options) => {
      registeredCallback = options?.onRegistered;
      return {
        needRefresh: [false, mockSetNeedRefresh],
        offlineReady: [false, vi.fn()],
        updateServiceWorker: mockUpdateServiceWorker,
      };
    });

    const { unmount } = render(<ReloadPrompt />);

    const mockRegistration = {
      update: vi.fn().mockRejectedValue(new Error('Network error during periodic update')),
    };

    act(() => {
      registeredCallback!(mockRegistration);
    });

    act(() => {
      vi.advanceTimersByTime(60 * 60 * 1000);
    });

    expect(mockRegistration.update).toHaveBeenCalledTimes(2);
    await act(async () => { await Promise.resolve(); });
    expect(consoleSpy).toHaveBeenCalledWith('SW update error:', expect.any(Error));

    unmount();
    consoleSpy.mockRestore();
    vi.useRealTimers();
  });

  test('Mobile Accessibility: Verifies accessibility, aria-labels and aria-live announcements', () => {
    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [true, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mockUpdateServiceWorker,
    });

    const { container } = render(<ReloadPrompt />);

    // Scope accessibility assertions to this component. Other independent
    // live regions (including a protected-vault storage failure) must not be
    // mistaken for the update toast or mask its aria-live contract.
    const alertContainer = within(container).getByRole('alert');
    expect(alertContainer.getAttribute('aria-live')).toBe('polite');
    expect(alertContainer.getAttribute('aria-atomic')).toBe('true');

    const updateBtn = screen.getByRole('button', { name: /Aggiorna/i });
    const closeBtn = screen.getByRole('button', { name: /Chiudi/i });

    expect(updateBtn.getAttribute('aria-label')).toBe('Aggiorna applicazione');
    expect(closeBtn.getAttribute('aria-label')).toBe('Chiudi notifica');
    expect(updateBtn.className).toContain('btn-primary');
    expect(closeBtn.className).toContain('btn-secondary');
  });

  test('Edge Case: Handles synchronous exception thrown by r.update() in periodic timer', () => {
    vi.useFakeTimers();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    let registeredCallback: ((r: any) => void) | undefined;

    vi.mocked(useRegisterSW).mockImplementation((options) => {
      registeredCallback = options?.onRegistered;
      return {
        needRefresh: [false, mockSetNeedRefresh],
        offlineReady: [false, vi.fn()],
        updateServiceWorker: mockUpdateServiceWorker,
      };
    });

    const { unmount } = render(<ReloadPrompt />);

    const mockRegistration = {
      update: vi.fn().mockImplementation(() => {
        throw new Error('Sync throw during update');
      }),
    };

    act(() => {
      registeredCallback!(mockRegistration);
    });

    // Advance 60 minutes - should not crash
    act(() => {
      vi.advanceTimersByTime(60 * 60 * 1000);
    });

    expect(mockRegistration.update).toHaveBeenCalledTimes(2);
    expect(consoleSpy).toHaveBeenCalledWith('SW update synchronous error:', expect.any(Error));

    unmount();
    consoleSpy.mockRestore();
    vi.useRealTimers();
  });

  test('Edge Case: Handles synchronous exception thrown by reg.update() on visibilitychange', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mockGetRegistration = vi.fn().mockResolvedValue({
      update: vi.fn().mockImplementation(() => {
        throw new Error('Sync throw on visibility update');
      }),
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

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(mockGetRegistration).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith('SW visibility update error:', expect.any(Error));

    unmount();
    consoleSpy.mockRestore();
  });

  test('Edge Case: Handles synchronous exception in manual worker activation on click', async () => {
    await prepareUnlockedTestArchive('user:test-user-id');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const throwingUpdate = vi.spyOn(pwaUpdateModule, 'applyPWAUpdate').mockImplementation(() => {
      throw new Error('Immediate sync throw');
    });

    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [true, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mockUpdateServiceWorker,
    });

    render(<ReloadPrompt />);

    const updateBtn = screen.getByRole('button', { name: /Aggiorna/i });
    await act(async () => {
      fireEvent.click(updateBtn);
    });

    expect(throwingUpdate).toHaveBeenCalledOnce();
    expect(screen.getByText('Immediate sync throw')).toBeDefined();
    consoleSpy.mockRestore();
  });
});
