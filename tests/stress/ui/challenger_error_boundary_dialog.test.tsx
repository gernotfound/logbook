import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import ErrorBoundary from '../../../src/components/UI/ErrorBoundary';
import { DB } from '../../../src/lib/db';
import { useDialogStore } from '../../../src/store/useDialogStore';
import { captureSession } from '../../../src/lib/sync/session';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';

describe('Error boundary and global dialog hardening', () => {
    describe('2. ErrorBoundary & GlobalDialog Hardening Verification', () => {
        const ThrowingComponent = ({ message }: { message?: string }) => {
            throw new Error(message || 'Fatal Component Explosion');
        };

        beforeEach(() => {
            vi.clearAllMocks();
            window.localStorage.clear();
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('renders children smoothly when no error is thrown', () => {
            render(
                <ErrorBoundary>
                    <div data-testid="child-ok">Application Running Normally</div>
                </ErrorBoundary>
            );

            expect(screen.getByTestId('child-ok').textContent).toBe('Application Running Normally');
        });

        it('catches fatal exception, mounts GlobalDialog, and renders fallback UI', () => {
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            render(
                <ErrorBoundary>
                    <ThrowingComponent message="Uncaught Crash in View" />
                </ErrorBoundary>
            );

            expect(screen.getByText('Ops, qualcosa è andato storto!')).toBeDefined();
            expect(screen.getByText('Si è verificato un errore imprevisto. Prova a ricaricare la pagina.')).toBeDefined();
            expect(screen.getByText(/Ricarica pagina/i)).toBeDefined();
            expect(screen.getByText(/Azzera dati locali/i)).toBeDefined();

            errorSpy.mockRestore();
        });

        it('reloads page safely when "Ricarica pagina" button is clicked', async () => {
            await prepareUnlockedTestArchive(captureSession().owner);
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const reloadMock = vi.fn();
            Object.defineProperty(window, 'location', {
                configurable: true,
                value: { reload: reloadMock }
            });

            render(
                <ErrorBoundary>
                    <ThrowingComponent />
                </ErrorBoundary>
            );

            fireEvent.click(screen.getByText(/Ricarica pagina/i));
            await waitFor(() => expect(reloadMock).toHaveBeenCalledTimes(1));

            errorSpy.mockRestore();
        });

        it('confirms and purges through the local-data boundary before reloading', async () => {
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const reloadMock = vi.fn();
            Object.defineProperty(window, 'location', {
                configurable: true,
                value: { reload: reloadMock }
            });

            vi.mocked(useDialogStore.getState().showConfirm).mockResolvedValue(true);
            vi.mocked(window.localStorage.clear).mockClear();

            render(
                <ErrorBoundary>
                    <ThrowingComponent />
                </ErrorBoundary>
            );

            const resetBtn = screen.getByText(/Azzera dati locali/i);
            await act(async () => {
                fireEvent.click(resetBtn);
            });

            expect(useDialogStore.getState().showConfirm).toHaveBeenCalledWith(
                'Questa operazione elimina i dati locali della sessione corrente, inclusi quelli non ancora sincronizzati. I dati già presenti nel cloud non vengono cancellati. Procedere?',
                'Azzera dati locali'
            );
            expect(DB.purgeAllLocalUserData).toHaveBeenCalledTimes(1);
            expect(window.localStorage.clear).not.toHaveBeenCalled();
            await waitFor(() => expect(reloadMock).toHaveBeenCalledTimes(1));

            errorSpy.mockRestore();
        });

        it('aborts local-data purge when confirmation is cancelled', async () => {
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const reloadMock = vi.fn();
            Object.defineProperty(window, 'location', {
                configurable: true,
                value: { reload: reloadMock }
            });

            vi.mocked(useDialogStore.getState().showConfirm).mockResolvedValue(false);
            vi.mocked(window.localStorage.clear).mockClear();

            render(
                <ErrorBoundary>
                    <ThrowingComponent />
                </ErrorBoundary>
            );

            const resetBtn = screen.getByText(/Azzera dati locali/i);
            await act(async () => {
                fireEvent.click(resetBtn);
            });

            expect(useDialogStore.getState().showConfirm).toHaveBeenCalled();
            expect(DB.purgeAllLocalUserData).not.toHaveBeenCalled();
            expect(window.localStorage.clear).not.toHaveBeenCalled();
            expect(reloadMock).not.toHaveBeenCalled();

            errorSpy.mockRestore();
        });
    });
});
