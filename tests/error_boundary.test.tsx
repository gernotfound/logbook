import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ErrorBoundary from '../src/components/UI/ErrorBoundary';
import { useDialogStore } from '../src/store/useDialogStore';

// Component that throws on demand
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

        // Mock window.location.reload
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
        expect(screen.getByText(/Hard reset \(dati corrotti\)/i)).toBeDefined();

        consoleErrorSpy.mockRestore();
    });

    it('reloads page when "Ricarica pagina" button is clicked', () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        render(
            <ErrorBoundary>
                <ProblemChild shouldThrow={true} />
            </ErrorBoundary>
        );

        fireEvent.click(screen.getByText(/Ricarica pagina/i));
        expect(window.location.reload).toHaveBeenCalledTimes(1);

        consoleErrorSpy.mockRestore();
    });

    it('triggers useDialogStore.getState().showConfirm when "Hard reset" button is clicked', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(useDialogStore.getState().showConfirm).mockResolvedValue(true);

        render(
            <ErrorBoundary>
                <ProblemChild shouldThrow={true} />
            </ErrorBoundary>
        );

        // Click Hard Reset button
        await act(async () => {
            fireEvent.click(screen.getByText(/Hard reset \(dati corrotti\)/i));
        });

        // showConfirm should have been called with proper message and title
        expect(useDialogStore.getState().showConfirm).toHaveBeenCalledWith(
            'Questo cancellerà tutti i dati non sincronizzati con il cloud. Procedere?',
            'Attenzione'
        );

        consoleErrorSpy.mockRestore();
    });

    it('clears localStorage and reloads when user confirms hard reset dialog', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(useDialogStore.getState().showConfirm).mockResolvedValue(true);
        vi.mocked(window.localStorage.clear).mockClear();
        vi.mocked(window.location.reload).mockClear();

        render(
            <ErrorBoundary>
                <ProblemChild shouldThrow={true} />
            </ErrorBoundary>
        );

        await act(async () => {
            fireEvent.click(screen.getByText(/Hard reset \(dati corrotti\)/i));
        });

        expect(useDialogStore.getState().showConfirm).toHaveBeenCalled();
        expect(window.localStorage.clear).toHaveBeenCalledTimes(1);
        expect(window.location.reload).toHaveBeenCalledTimes(1);

        consoleErrorSpy.mockRestore();
    });

    it('does NOT clear localStorage or reload when user cancels hard reset dialog', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(useDialogStore.getState().showConfirm).mockResolvedValue(false);
        vi.mocked(window.localStorage.clear).mockClear();
        vi.mocked(window.location.reload).mockClear();

        render(
            <ErrorBoundary>
                <ProblemChild shouldThrow={true} />
            </ErrorBoundary>
        );

        await act(async () => {
            fireEvent.click(screen.getByText(/Hard reset \(dati corrotti\)/i));
        });

        expect(useDialogStore.getState().showConfirm).toHaveBeenCalled();
        expect(window.localStorage.clear).not.toHaveBeenCalled();
        expect(window.location.reload).not.toHaveBeenCalled();

        consoleErrorSpy.mockRestore();
    });
});
