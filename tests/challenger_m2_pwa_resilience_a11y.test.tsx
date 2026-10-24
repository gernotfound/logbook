import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';

// Unmock useDialogStore so we test the real store and component integration
vi.unmock('../src/store/useDialogStore');

import { GlobalDialog } from '../src/components/UI/GlobalDialog';
import { useDialogStore } from '../src/store/useDialogStore';
import { requestDurableStorage } from '../src/lib/storageStatus';

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

    describe('2. Browser persistent-storage capability', () => {
        const originalStorage = navigator.storage;
        const setStorage = (value: unknown) => Object.defineProperty(navigator, 'storage', {
            value, configurable: true, writable: true,
        });

        afterEach(() => {
            setStorage(originalStorage);
            vi.restoreAllMocks();
        });

        it('reports unsupported storage when navigator.storage is missing', async () => {
            setStorage(undefined);
            await expect(requestDurableStorage()).resolves.toEqual({ supported: false, persistent: false });
        });

        it('requires both persisted and persist capabilities before requesting durability', async () => {
            const persist = vi.fn().mockResolvedValue(true);
            setStorage({ persist });
            await expect(requestDurableStorage()).resolves.toEqual({ supported: false, persistent: false });
            expect(persist).not.toHaveBeenCalled();

            const persisted = vi.fn().mockResolvedValue(false);
            setStorage({ persisted });
            await expect(requestDurableStorage()).resolves.toEqual({ supported: false, persistent: false });
            expect(persisted).not.toHaveBeenCalled();
        });

        it('reuses an existing durability grant without requesting it again', async () => {
            const persisted = vi.fn().mockResolvedValue(true);
            const persist = vi.fn();
            const estimate = vi.fn().mockResolvedValue({ usage: 128, quota: 1024 });
            setStorage({ persisted, persist, estimate });
            await expect(requestDurableStorage()).resolves.toEqual({
                supported: true, persistent: true, usage: 128, quota: 1024,
            });
            expect(persisted).toHaveBeenCalledOnce();
            expect(persist).not.toHaveBeenCalled();
            expect(estimate).toHaveBeenCalledOnce();
        });

        it('requests persistence when not already granted and returns the browser decision', async () => {
            const persist = vi.fn().mockResolvedValue(true);
            setStorage({ persisted: vi.fn().mockResolvedValue(false), persist });
            await expect(requestDurableStorage()).resolves.toEqual({
                supported: true, persistent: true, usage: undefined, quota: undefined,
            });
            expect(persist).toHaveBeenCalledOnce();

            persist.mockResolvedValue(false);
            await expect(requestDurableStorage()).resolves.toEqual({
                supported: true, persistent: false, usage: undefined, quota: undefined,
            });
            expect(persist).toHaveBeenCalledTimes(2);
        });

        it('contains a rejected persistence request without an unhandled rejection', async () => {
            const error = new Error('Permission denied');
            const log = vi.spyOn(console, 'error').mockImplementation(() => {});
            const persist = vi.fn().mockRejectedValue(error);
            setStorage({ persisted: vi.fn().mockResolvedValue(false), persist });
            await expect(requestDurableStorage()).resolves.toEqual({ supported: true, persistent: false });
            expect(persist).toHaveBeenCalledOnce();
            expect(log).toHaveBeenCalledWith('Errore durante la richiesta di storage persistente:', error);
        });

        it('contains persisted/estimate failures instead of blocking bootstrap', async () => {
            const error = new Error('Storage estimate unavailable');
            const log = vi.spyOn(console, 'error').mockImplementation(() => {});
            setStorage({ persisted: vi.fn().mockRejectedValue(error), persist: vi.fn() });
            await expect(requestDurableStorage()).resolves.toEqual({ supported: true, persistent: false });
            expect(log).toHaveBeenCalledWith('Errore durante la richiesta di storage persistente:', error);

            const estimate = vi.fn().mockRejectedValue(error);
            setStorage({ persisted: vi.fn().mockResolvedValue(true), persist: vi.fn(), estimate });
            await expect(requestDurableStorage()).resolves.toEqual({ supported: true, persistent: false });
            expect(estimate).toHaveBeenCalledOnce();
        });
    });

    // The build-dependent Workbox/precache contract runs in test:pwa:m7 after
    // npm run build, where missing dist/sw.js fails instead of passing vacuously.
});
