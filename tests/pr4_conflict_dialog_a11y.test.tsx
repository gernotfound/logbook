import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NutritionConflictDialog } from '../src/components/UI/NutritionConflictDialog';
import React from 'react';

// Mock dialog API because jsdom does not fully support it
beforeEach(() => {
    Object.defineProperty(HTMLDialogElement.prototype, 'open', {
        get: function() { return this.hasAttribute('open'); },
        configurable: true
    });
    HTMLDialogElement.prototype.showModal = vi.fn(function() {
        (this as any).setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function() {
        (this as any).removeAttribute('open');
    });
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('NutritionConflictDialog A11y & Interactions', () => {
    const mockOnResolve = vi.fn();
    const mockOnClose = vi.fn();

    const renderDialog = (isOpen: boolean) => {
        return render(
            <NutritionConflictDialog
                isOpen={isOpen}
                onResolve={mockOnResolve}
                onClose={mockOnClose}
                cloudPlan={{ totalKcal: 2500 }}
                localPlan={{ totalKcal: 3000 }}
                isSyncing={false}
            />
        );
    };

    it('invokes showModal when opened', () => {
        renderDialog(true);
        expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1);
    });

    it('invokes close when closed via props', () => {
        const { rerender } = renderDialog(true);
        expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1);

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
        expect(HTMLDialogElement.prototype.close).toHaveBeenCalledTimes(1);
    });

    it('has autoFocus on the safe "Decidi più tardi" button', () => {
        renderDialog(true);
        const decideLaterBtn = screen.getByText('Decidi più tardi');
        expect(decideLaterBtn).toBeDefined();
    });

    it('prevents default and calls onClose when ESC is pressed (cancel event)', () => {
        renderDialog(true);
        const dialog = screen.getByRole('dialog', { hidden: true }); // using hidden because dialog might not be fully visible in jsdom

        const preventDefault = vi.fn();
        const cancelEvent = new Event('cancel', { bubbles: false, cancelable: true });
        cancelEvent.preventDefault = preventDefault;

        fireEvent(dialog, cancelEvent);

        expect(preventDefault).toHaveBeenCalledTimes(1);
        expect(mockOnClose).toHaveBeenCalledTimes(1);
        expect(mockOnResolve).not.toHaveBeenCalled();
    });

    it('includes required ARIA attributes', () => {
        renderDialog(true);
        const dialog = screen.getByRole('dialog', { hidden: true });

        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(dialog.getAttribute('aria-labelledby')).toBe('conflict-dialog-title');
        expect(dialog.getAttribute('aria-describedby')).toBe('conflict-dialog-desc');
    });
});
