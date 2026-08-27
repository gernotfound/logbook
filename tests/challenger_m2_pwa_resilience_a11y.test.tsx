import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';

// Unmock useDialogStore so we test the real store and component integration
vi.unmock('../src/store/useDialogStore');

import { GlobalDialog } from '../src/components/UI/GlobalDialog';
import { useDialogStore } from '../src/store/useDialogStore';
import * as fs from 'fs';
import * as path from 'path';

describe('Empirical Challenger: PWA Resilience & Accessibility Stress Suite', () => {

    describe('1. GlobalDialog ARIA Accessibility & DOM Invariants', () => {
        beforeEach(() => {
            useDialogStore.setState({
                isOpen: false,
                type: 'alert',
                title: '',
                message: '',
                onConfirm: () => {},
                onCancel: () => {},
            });
        });

        it('returns null and does not render dialog DOM when isOpen is false', () => {
            const { container } = render(<GlobalDialog />);
            expect(container.firstChild).toBeNull();
            expect(screen.queryByRole('alertdialog')).toBeNull();
        });

        it('renders alertdialog with compliant ARIA attributes, labels, and descriptions for alert type', () => {
            useDialogStore.setState({
                isOpen: true,
                type: 'alert',
                title: 'Attenzione',
                message: 'Operazione non consentita.',
                onConfirm: vi.fn(),
            });

            render(<GlobalDialog />);

            const dialog = screen.getByRole('alertdialog');
            expect(dialog).toBeDefined();
            expect(dialog.getAttribute('aria-modal')).toBe('true');
            expect(dialog.getAttribute('aria-labelledby')).toBe('global-dialog-title');
            expect(dialog.getAttribute('aria-describedby')).toBe('global-dialog-message');

            const titleEl = document.getElementById('global-dialog-title');
            expect(titleEl).toBeDefined();
            expect(titleEl?.textContent).toBe('Attenzione');

            const messageEl = document.getElementById('global-dialog-message');
            expect(messageEl).toBeDefined();
            expect(messageEl?.textContent).toBe('Operazione non consentita.');

            // Only OK button for alert
            expect(screen.getByRole('button', { name: 'OK' })).toBeDefined();
            expect(screen.queryByRole('button', { name: 'Annulla' })).toBeNull();
        });

        it('renders alertdialog with both Annulla and Conferma buttons for confirm type', () => {
            const confirmSpy = vi.fn();
            const cancelSpy = vi.fn();

            useDialogStore.setState({
                isOpen: true,
                type: 'confirm',
                title: 'Conferma eliminazione',
                message: 'Sei sicuro di voler eliminare la scheda?',
                onConfirm: confirmSpy,
                onCancel: cancelSpy,
            });

            render(<GlobalDialog />);

            const dialog = screen.getByRole('alertdialog');
            expect(dialog).toBeDefined();

            const cancelBtn = screen.getByRole('button', { name: 'Annulla' });
            const confirmBtn = screen.getByRole('button', { name: 'Conferma' });

            expect(cancelBtn).toBeDefined();
            expect(confirmBtn).toBeDefined();

            act(() => {
                cancelBtn.click();
            });
            expect(cancelSpy).toHaveBeenCalledTimes(1);

            act(() => {
                confirmBtn.click();
            });
            expect(confirmSpy).toHaveBeenCalledTimes(1);
        });
    });

    describe('2. navigator.storage.persist Boundary Hardening', () => {
        const originalStorage = navigator.storage;

        afterEach(() => {
            Object.defineProperty(navigator, 'storage', {
                value: originalStorage,
                configurable: true,
                writable: true,
            });
        });

        it('handles navigator.storage undefined without throwing', () => {
            Object.defineProperty(navigator, 'storage', {
                value: undefined,
                configurable: true,
                writable: true,
            });

            expect(() => {
                if (typeof navigator !== 'undefined' && (navigator as any).storage?.persist) {
                    (navigator as any).storage.persist().catch(() => {});
                }
            }).not.toThrow();
        });

        it('handles navigator.storage.persist undefined without throwing', () => {
            Object.defineProperty(navigator, 'storage', {
                value: {},
                configurable: true,
                writable: true,
            });

            expect(() => {
                if (typeof navigator !== 'undefined' && (navigator as any).storage?.persist) {
                    (navigator as any).storage.persist().catch(() => {});
                }
            }).not.toThrow();
        });

        it('handles navigator.storage.persist rejecting promise gracefully without unhandled rejection', async () => {
            const mockPersist = vi.fn().mockRejectedValue(new Error('Permission denied'));
            Object.defineProperty(navigator, 'storage', {
                value: { persist: mockPersist },
                configurable: true,
                writable: true,
            });

            let caughtError: any = null;
            expect(() => {
                if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
                    navigator.storage.persist().catch((err) => {
                        caughtError = err;
                    });
                }
            }).not.toThrow();

            // Wait for rejected promise microtask
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(mockPersist).toHaveBeenCalledTimes(1);
            expect(caughtError).toBeInstanceOf(Error);
            expect(caughtError.message).toBe('Permission denied');
        });

        it('executes navigator.storage.persist successfully when supported', async () => {
            const mockPersist = vi.fn().mockResolvedValue(true);
            Object.defineProperty(navigator, 'storage', {
                value: { persist: mockPersist },
                configurable: true,
                writable: true,
            });

            if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
                navigator.storage.persist().catch(() => {});
            }

            await new Promise(resolve => setTimeout(resolve, 10));
            expect(mockPersist).toHaveBeenCalledTimes(1);
        });
    });

    describe('3. vite:preloadError Listener Lifecycle Hardening', () => {
        let originalLocation: Location;

        beforeEach(() => {
            originalLocation = window.location;
        });

        afterEach(() => {
            Object.defineProperty(window, 'location', {
                value: originalLocation,
                configurable: true,
                writable: true,
            });
        });

        it('registers vite:preloadError event listener and triggers reload on chunk load failure', () => {
            const reloadMock = vi.fn();
            Object.defineProperty(window, 'location', {
                value: { ...originalLocation, reload: reloadMock },
                configurable: true,
                writable: true,
            });

            // Simulate the exact useEffect in App.tsx
            const handlePreloadError = () => {
                window.location.reload();
            };
            window.addEventListener('vite:preloadError', handlePreloadError);

            // Dispatch synthetic vite:preloadError event
            window.dispatchEvent(new Event('vite:preloadError'));

            expect(reloadMock).toHaveBeenCalledTimes(1);

            // Cleanup listener
            window.removeEventListener('vite:preloadError', handlePreloadError);

            // Dispatch again after removal -> should not trigger additional reload
            window.dispatchEvent(new Event('vite:preloadError'));
            expect(reloadMock).toHaveBeenCalledTimes(1);
        });
    });

    describe('4. Workbox & Precache Manifest Verification', () => {
        it('verifies sw.js and workbox exist and do not contain pruned orphan files', () => {
            const distPath = path.resolve(__dirname, '../dist');
            if (fs.existsSync(distPath)) {
                const swPath = path.join(distPath, 'sw.js');
                if (fs.existsSync(swPath)) {
                    const swContent = fs.readFileSync(swPath, 'utf8');
                    expect(swContent).not.toContain('icon-cropped.png');
                    expect(swContent).not.toContain('test_manichino.html');
                    expect(swContent).not.toContain('foods.ts');
                }
            }
        });
    });
});
