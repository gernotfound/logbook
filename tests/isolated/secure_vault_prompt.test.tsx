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

        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveAccessibleName('Archivio locale temporaneamente non disponibile');
        expect(dialog).toHaveAccessibleDescription(/Non cancellare i dati/);
        expect(button).toHaveFocus();
        expect(previous.inert).toBe(true);
        expect(alreadyInert.inert).toBe(true);
        expect(document.body.style.overflow).toBe('hidden');

        previous.focus();
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
        expect(button).toHaveFocus();
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(button).toHaveFocus();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(dialog).toBeInTheDocument();

        fireEvent.click(button);
        expect(retry).toHaveBeenCalledTimes(1);
        view.unmount();

        expect(previous.inert).toBe(false);
        expect(alreadyInert.inert).toBe(true);
        expect(document.body.style.overflow).toBe('auto');
        expect(previous).toHaveFocus();
    } finally {
        previous.remove();
        alreadyInert.remove();
    }
});

it('keeps long recovery guidance scrollable inside a short viewport', () => {
    const view = render(<SecureVaultPrompt error="Storage unavailable" retry={() => {}} />);
    const panel = screen.getByRole('alertdialog').querySelector('.auth-panel');
    expect(panel).not.toBeNull();
    expect(panel).toHaveStyle({ overflowY: 'auto', boxSizing: 'border-box' });
    expect(panel).toHaveStyle({ maxHeight: 'calc(100dvh - 36px)' });
    expect(screen.getByText('Storage unavailable')).toHaveAttribute('role', 'alert');
    view.unmount();
});
