import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ErrorBoundary from '../src/components/UI/ErrorBoundary';
import { DB } from '../src/lib/db';
import { useDialogStore } from '../src/store/useDialogStore';
import { idbStore, localStorageMock } from './setup';

const ProblemChild = ({ shouldThrow }: { shouldThrow: boolean }) => {
    if (shouldThrow) {
        throw new Error('Test error boundary explosion');
    }
    return <div>Normal Content</div>;
};

describe('R2: ErrorBoundary & Dialog Hardening Suite', () => {
    const originalLocation = window.location;

    beforeEach(() => {
        vi.clearAllMocks();
        window.localStorage.clear();

        Object.defineProperty(window, 'location', {
            configurable: true,
            value: {
                ...originalLocation,
                reload: vi.fn()
            }
        });
    });

    afterEach(() => {
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: originalLocation
        });
        vi.restoreAllMocks();
    });

    it('renders children when no uncaught error occurs', () => {
        render(
            <ErrorBoundary>
                <div>Hello Safe World</div>
            </ErrorBoundary>
        );

        expect(screen.getByText('Hello Safe World')).toBeDefined();
    });

    it('renders fallback error UI when a child throws', () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        render(
            <ErrorBoundary>
                <ProblemChild shouldThrow={true} />
            </ErrorBoundary>
        );

        expect(screen.getByText('Ops, qualcosa è andato storto!')).toBeDefined();
        expect(screen.getByText(/Ricarica pagina/i)).toBeDefined();
        expect(screen.getByText(/Azzera dati locali/i)).toBeDefined();

        consoleErrorSpy.mockRestore();
    });

    it('reloads page safely when "Ricarica pagina" button is clicked', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        render(
            <ErrorBoundary>
                <ProblemChild shouldThrow={true} />
            </ErrorBoundary>
        );

        await act(async () => {
            fireEvent.click(screen.getByText(/Ricarica pagina/i));
        });
        expect(window.location.reload).toHaveBeenCalledTimes(1);

        consoleErrorSpy.mockRestore();
    });

    it('asks for explicit confirmation before deleting local data', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(useDialogStore.getState().showConfirm).mockResolvedValue(false);

        render(
            <ErrorBoundary>
                <ProblemChild shouldThrow={true} />
            </ErrorBoundary>
        );

        await act(async () => {
            fireEvent.click(screen.getByText(/Azzera dati locali/i));
        });

        expect(useDialogStore.getState().showConfirm).toHaveBeenCalledWith(
            'Questa operazione elimina i dati locali della sessione corrente, inclusi quelli non ancora sincronizzati. I dati già presenti nel cloud non vengono cancellati. Procedere?',
            'Azzera dati locali'
        );
        expect(DB.purgeAllLocalUserData).not.toHaveBeenCalled();
        expect(window.location.reload).not.toHaveBeenCalled();

        consoleErrorSpy.mockRestore();
    });

    it('purges the current owner envelope without clearing unrelated localStorage, then reloads', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(useDialogStore.getState().showConfirm).mockResolvedValue(true);
        idbStore['logbook:v2:user:test-user-id'] = { data: { profile: { name: 'Luigi' } } };
        localStorage.setItem('logbook:v2:user:test-user-id:workout', '{"id":"w1"}');
        localStorage.setItem('unrelated-app-key', 'keep-me');
        vi.mocked(localStorageMock.clear).mockClear();
        vi.mocked(window.location.reload).mockClear();

        render(
            <ErrorBoundary>
                <ProblemChild shouldThrow={true} />
            </ErrorBoundary>
        );

        await act(async () => {
            fireEvent.click(screen.getByText(/Azzera dati locali/i));
        });

        expect(DB.purgeAllLocalUserData).toHaveBeenCalledTimes(1);
        expect(idbStore['logbook:v2:user:test-user-id']).toBeUndefined();
        expect(localStorage.getItem('logbook:v2:user:test-user-id:workout')).toBeNull();
        expect(localStorage.getItem('unrelated-app-key')).toBe('keep-me');
        expect(localStorageMock.clear).not.toHaveBeenCalled();
        expect(window.location.reload).toHaveBeenCalledTimes(1);

        consoleErrorSpy.mockRestore();
    });

    it('does not reload and reports the failure when local purge is incomplete', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(useDialogStore.getState().showConfirm).mockResolvedValue(true);
        vi.mocked(DB.purgeAllLocalUserData).mockRejectedValueOnce(new Error('IndexedDB delete failed'));
        vi.mocked(window.location.reload).mockClear();

        render(
            <ErrorBoundary>
                <ProblemChild shouldThrow={true} />
            </ErrorBoundary>
        );

        await act(async () => {
            fireEvent.click(screen.getByText(/Azzera dati locali/i));
        });

        expect(DB.purgeAllLocalUserData).toHaveBeenCalledTimes(1);
        expect(window.location.reload).not.toHaveBeenCalled();
        expect(useDialogStore.getState().showAlert).toHaveBeenCalledWith(
            'Pulizia locale non completata. I dati rimasti sul dispositivo non sono stati dichiarati eliminati. Riprova o ricarica la pagina.'
        );

        consoleErrorSpy.mockRestore();
    });
});
