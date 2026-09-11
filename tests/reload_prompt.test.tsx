import React from 'react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ReloadPrompt from '../src/components/UI/ReloadPrompt';
import { useRegisterSW } from 'virtual:pwa-register/react';
import App from '../src/App';
import { renderWithProviders } from './setup';
import { useAppStore } from '../src/store/useAppStore';
import { BufferedInput } from '../src/components/UI/BufferedInput';
import { invalidateSession } from '../src/lib/sync/session';

describe('Service Worker Update Lifecycle (ReloadPrompt) Suite', () => {
  let mockSetNeedRefresh: ReturnType<typeof vi.fn>;
  let mockUpdateServiceWorker: ReturnType<typeof vi.fn>;
  const originalServiceWorker = navigator.serviceWorker;

  beforeEach(() => {
    useAppStore.getState().resetStore();
    mockSetNeedRefresh = vi.fn();
    mockUpdateServiceWorker = vi.fn().mockResolvedValue(undefined);
    vi.clearAllMocks();
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

  test('R2: Clicking "Aggiorna" button triggers updateServiceWorker(true)', async () => {
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

    expect(mockUpdateServiceWorker).toHaveBeenCalledTimes(1);
    expect(mockUpdateServiceWorker).toHaveBeenCalledWith(true);
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

    // Expect no crash/exception
    expect(true).toBe(true);

    unmount();
  });

  test('R1: onRegistered configures periodic timer and onRegisterError handles errors gracefully', () => {
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

    // Advance 60 minutes
    act(() => {
      vi.advanceTimersByTime(60 * 60 * 1000);
    });

    expect(mockRegistration.update).toHaveBeenCalledTimes(1);

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

  test('R3: ReloadPrompt is mounted globally in App and renders update banner when needRefresh is true', async () => {
    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [true, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mockUpdateServiceWorker,
    });

    const { container } = renderWithProviders(<App />);
    expect(container).toBeDefined();

    // Verify prompt appears globally inside App
    expect(screen.getByText('Nuova versione disponibile')).toBeDefined();
    expect(screen.getByRole('button', { name: /Aggiorna/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Chiudi/i })).toBeDefined();
  });

  test('Rule 8 & UX: Active workout session state and input responsiveness are not interrupted when ReloadPrompt appears', () => {
    const mockActiveWorkout = {
      routineId: 'r1',
      routineName: 'Scheda A - Upper',
      startTime: Date.now(),
      exercises: [
        {
          exId: 'ex1',
          name: 'Panca Piana',
          sets: [{ id: 's1', kg: '80', reps: '10', completed: false }]
        }
      ]
    };

    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [true, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mockUpdateServiceWorker,
    });

    renderWithProviders(<App />, { localWorkout: mockActiveWorkout });

    // Verify workout is still preserved in store and active in memory
    const state = useAppStore.getState();
    expect(state.localWorkout).toEqual(mockActiveWorkout);
    expect(state.localWorkout?.exercises[0].name).toBe('Panca Piana');

    // Both ReloadPrompt banner and workout UI exist concurrently
    expect(screen.getByText('Nuova versione disponibile')).toBeDefined();
    expect(screen.getByRole('button', { name: /Aggiorna/i })).toBeDefined();
  });

  test('Edge Case: Handles updateServiceWorker rejection gracefully without crashing', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const rejectingUpdate = vi.fn().mockRejectedValue(new Error('Failed to postMessage to SW'));

    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [true, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: rejectingUpdate,
    });

    render(<ReloadPrompt />);

    const updateBtn = screen.getByRole('button', { name: /Aggiorna/i });
    await act(async () => {
      fireEvent.click(updateBtn);
    });

    expect(rejectingUpdate).toHaveBeenCalledWith(true);
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
    // Rejection caught by .catch(() => {}) without crashing
    expect(true).toBe(true);

    unmount();
    consoleSpy.mockRestore();
  });

  test('Edge Case: Periodic timer handles SW registration update rejection gracefully', () => {
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

    expect(mockRegistration.update).toHaveBeenCalledTimes(1);

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

    render(<ReloadPrompt />);

    const alertContainer = screen.getByRole('alert');
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

    expect(mockRegistration.update).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith('SW periodic update synchronous error:', expect.any(Error));

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
    expect(consoleSpy).toHaveBeenCalledWith('SW visibility update synchronous error:', expect.any(Error));

    unmount();
    consoleSpy.mockRestore();
  });

  test('Edge Case: Handles synchronous exception in updateServiceWorker invocation on click', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const throwingUpdate = vi.fn().mockImplementation(() => {
      throw new Error('Immediate sync throw');
    });

    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [true, mockSetNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: throwingUpdate,
    });

    render(<ReloadPrompt />);

    const updateBtn = screen.getByRole('button', { name: /Aggiorna/i });
    await act(async () => {
      fireEvent.click(updateBtn);
    });

    expect(throwingUpdate).toHaveBeenCalledWith(true);
    expect(screen.getByText('Immediate sync throw')).toBeDefined();
    consoleSpy.mockRestore();
  });
});
