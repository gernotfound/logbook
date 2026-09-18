import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NutritionConflictDialog } from '../src/components/UI/NutritionConflictDialog';
import React from 'react';

const mockOnResolve = vi.fn();
const mockOnClose = vi.fn();

const renderDialog = (isOpen: boolean, isSyncing = false) => render(
    <NutritionConflictDialog
        isOpen={isOpen}
        onResolve={mockOnResolve}
        onClose={mockOnClose}
        cloudPlan={{ totalKcal: 2500 }}
        localPlan={{ totalKcal: 3000 }}
        isSyncing={isSyncing}
    />
);

beforeEach(() => {
    mockOnResolve.mockReset();
    mockOnClose.mockReset();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('NutritionConflictDialog A11y & Interactions', () => {
    it('uses an app-controlled overlay instead of native dialog', () => {
        renderDialog(true);

        const dialog = screen.getByRole('dialog');
        expect(dialog.tagName).toBe('DIV');
        expect(document.querySelector('dialog')).toBeNull();
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(dialog.getAttribute('aria-labelledby')).toBe('conflict-dialog-title');
        expect(dialog.getAttribute('aria-describedby')).toBe('conflict-dialog-desc');
    });

    it('focuses the safe action and traps forward Tab inside the overlay', async () => {
        renderDialog(true);

        const safeButton = screen.getByRole('button', { name: 'Decidi più tardi' });
        await waitFor(() => expect(document.activeElement).toBe(safeButton));

        fireEvent.keyDown(document, { key: 'Tab' });
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Mantieni dispositivo' }));
    });

    it('closes on Escape when no resolution is in progress', () => {
        renderDialog(true);

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(mockOnClose).toHaveBeenCalledTimes(1);
        expect(mockOnResolve).not.toHaveBeenCalled();
    });

    it('ignores Escape while a resolution is in progress', () => {
        renderDialog(true, true);

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(mockOnClose).not.toHaveBeenCalled();
    });

    it('restores focus to the element active before opening', async () => {
        const trigger = document.createElement('button');
        trigger.textContent = 'Apri conflitto';
        document.body.appendChild(trigger);
        trigger.focus();

        const { rerender } = renderDialog(true);
        await waitFor(() => expect(document.activeElement).not.toBe(trigger));

        rerender(
            <NutritionConflictDialog
                isOpen={false}
                onResolve={mockOnResolve}
                onClose={mockOnClose}
                cloudPlan={{ totalKcal: 2500 }}
                localPlan={{ totalKcal: 3000 }}
                isSyncing={false}
            />
        );

        await waitFor(() => expect(document.activeElement).toBe(trigger));
        trigger.remove();
    });
});
