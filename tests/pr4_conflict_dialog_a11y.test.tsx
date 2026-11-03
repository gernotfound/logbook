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
        cloudPlan={{ weight: 80, avgMacros: { carbsPerKg: 3.5, proPerKg: 2, fatPerKg: 1 } }}
        localPlan={{ weight: 90, avgMacros: { carbsPerKg: 3.5, proPerKg: 2, fatPerKg: 1 } }}
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
    it('compares calories calculated from current ratios and ignores a stale stored total', () => {
        const cloudPlan = { weight: 80, avgMacros: { carbsPerKg: 3.5, proPerKg: 2, fatPerKg: 1 }, totalKcal: 99999 };
        const localPlan = { weight: 90, avgMacros: { carbsPerKg: 3.5, proPerKg: 2, fatPerKg: 1 } };
        render(<NutritionConflictDialog isOpen onResolve={mockOnResolve} onClose={mockOnClose}
            cloudPlan={cloudPlan} localPlan={localPlan} />);
        expect(screen.getByText('2480 kcal')).toBeDefined();
        expect(screen.getByText('2790 kcal')).toBeDefined();
        expect(screen.queryByText('99999 kcal')).toBeNull();
    });

    it('distinguishes a zero macro target from a plan without reference inputs', () => {
        render(<NutritionConflictDialog isOpen onResolve={mockOnResolve} onClose={mockOnClose}
            cloudPlan={{}} localPlan={{ weight: 80, avgMacros: { carbsPerKg: 0, proPerKg: 0, fatPerKg: 0 } }} />);
        expect(screen.getByText('N/D kcal')).toBeDefined();
        expect(screen.getByText('0 kcal')).toBeDefined();
    });

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
                cloudPlan={{ weight: 80, avgMacros: { carbsPerKg: 3.5, proPerKg: 2, fatPerKg: 1 } }}
                localPlan={{ weight: 90, avgMacros: { carbsPerKg: 3.5, proPerKg: 2, fatPerKg: 1 } }}
                isSyncing={false}
            />
        );

        await waitFor(() => expect(document.activeElement).toBe(trigger));
        trigger.remove();
    });
});
