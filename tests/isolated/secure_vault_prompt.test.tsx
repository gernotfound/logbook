import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SecureVaultPrompt } from '../../src/lib/sync/SecureVaultPrompt';

afterEach(() => {
    document.body.style.overflow = '';
});

it('locks focus to the only safe recovery action and restores background state on exit', () => {
    const previous = document.createElement('button');
    previous.textContent = 'Background action';
    document.body.appendChild(previous);
    const alreadyInert = document.createElement('section');
    alreadyInert.inert = true;
    document.body.appendChild(alreadyInert);
    document.body.style.overflow = 'auto';
    previous.focus();

    const retry = vi.fn();
    try {
        const view = render(<SecureVaultPrompt error="Storage unavailable" retry={retry} />);
        const dialog = screen.getByRole('alertdialog');
        const button = screen.getByRole('button', { name: 'Riprova' });

        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('Archivio locale temporaneamente non disponibile');
        expect(document.getElementById(dialog.getAttribute('aria-describedby') ?? '')?.textContent).toContain('Non cancellare i dati');
        expect(document.activeElement).toBe(button);
        expect(previous.inert).toBe(true);
        expect(alreadyInert.inert).toBe(true);
        expect(document.body.style.overflow).toBe('hidden');

        previous.focus();
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(button);
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(document.activeElement).toBe(button);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(document.body.contains(dialog)).toBe(true);

        fireEvent.click(button);
        expect(retry).toHaveBeenCalledTimes(1);
        view.unmount();

        expect(previous.inert).toBe(false);
        expect(alreadyInert.inert).toBe(true);
        expect(document.body.style.overflow).toBe('auto');
        expect(document.activeElement).toBe(previous);
    } finally {
        previous.remove();
        alreadyInert.remove();
    }
});

it('keeps long recovery guidance scrollable inside a short viewport', () => {
    const view = render(<SecureVaultPrompt error="Storage unavailable" retry={() => {}} />);
    const panel = screen.getByRole('alertdialog').querySelector('.auth-panel');
    expect(panel).not.toBeNull();
    expect(panel instanceof HTMLElement && panel.style.overflowY).toBe('auto');
    expect(panel instanceof HTMLElement && panel.style.boxSizing).toBe('border-box');
    expect(panel instanceof HTMLElement && panel.style.maxHeight).toBe('calc(100dvh - 36px)');
    expect(screen.getByText('Storage unavailable').getAttribute('role')).toBe('alert');
    view.unmount();
});
