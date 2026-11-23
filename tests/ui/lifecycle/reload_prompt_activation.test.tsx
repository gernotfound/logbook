import React from 'react';
import type { UserData } from '../../../src/types';
import { beforeEach, afterEach, describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ReloadPrompt from '../../../src/components/UI/ReloadPrompt';
import { useRegisterSW } from '../../../src/lib/pwaRegistration';
import { idbStore, localStorageMock, mockFirebaseAuth } from '../../setup';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { protectedDeviceKey, readDeviceValueStrict } from '../../../src/lib/sync/deviceStorage';
import { initializeLocal } from '../../../src/lib/sync/localRepository';
import { vaultControlKey } from '../../../src/lib/sync/secureArchiveSession';
import { UserDataSchema } from '../../../src/lib/schema';
import { useAppStore } from '../../../src/store/useAppStore';
import { BufferedInput } from '../../../src/components/UI/BufferedInput';
import { invalidateSession } from '../../../src/lib/sync/session';
import * as pwaUpdateModule from '../../../src/lib/pwaUpdate';
import * as reloadBarrierModule from '../../../src/lib/sync/reloadBarrier';
import { setupReloadPromptTest, teardownReloadPromptTest, mockSetNeedRefresh, mockUpdateServiceWorker } from './reloadPromptTestFixture';

describe('PWA reload activation and data barriers', () => {
  beforeEach(setupReloadPromptTest);
  afterEach(teardownReloadPromptTest);

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

    expect(screen.getByText(/Archivio protetto non pronto.*dati locali sono conservati/i)).toBeDefined();
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

  test('a dirty buffered field leaves a sealed owner-scoped recovery copy before session invalidation', async () => {
    const owner = 'user:test-user-id';
    await prepareUnlockedTestArchive(owner);
    localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
    const update = vi.fn();
    const { unmount } = render(<BufferedInput id="recoverable-draft" value="" onChange={update} aria-label="Recoverable" />);
    fireEvent.change(screen.getByLabelText('Recoverable'), { target: { value: '82,5' } });
    const name = 'draft:buffered:input:recoverable-draft';
    const ciphertext = localStorage.getItem(protectedDeviceKey(name, owner));
    expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
    expect(JSON.parse(readDeviceValueStrict(name, owner)!)).toMatchObject({
      __logbookBufferedDraft: 1, owner, name, consentRevision: 3, value: '82,5',
    });
    invalidateSession();
    unmount();
    expect(localStorage.getItem(protectedDeviceKey(name, owner))).toBe(ciphertext);
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
});
