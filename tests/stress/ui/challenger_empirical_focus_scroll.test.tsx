import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import SessionSetRow from '../../../src/components/Training/session/SessionSetRow';
import ExerciseSearchDropdown from '../../../src/components/Training/ExerciseSearchDropdown';
import type { SessionExerciseSet, ExerciseLibraryItem } from '../../../src/types';

describe('Empirical Challenger Focus & Scroll Suite', () => {
    let originalScrollTo: typeof window.scrollTo;
    let originalElementScrollIntoView: PropertyDescriptor | undefined;
    let originalHtmlScrollIntoView: PropertyDescriptor | undefined;
    let scrollToSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        originalScrollTo = window.scrollTo;
        originalElementScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
        originalHtmlScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
        scrollToSpy = vi.fn();
        Object.defineProperty(window, 'scrollTo', { configurable: true, writable: true, value: scrollToSpy });
    });

    afterEach(() => {
        window.scrollTo = originalScrollTo;
        if (originalElementScrollIntoView) Object.defineProperty(Element.prototype, 'scrollIntoView', originalElementScrollIntoView);
        else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
        if (originalHtmlScrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalHtmlScrollIntoView);
        else delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
        vi.restoreAllMocks();
    });

    describe('1. Desktop Input Focus Empirical Verification (Zero Scroll Displacement)', () => {
        const mockSet: SessionExerciseSet = {
            id: 'set-empirical-1',
            kg: '80',
            reps: '10'
        };

        it('clicking and focusing numeric inputs produces zero window.scrollTo calls on desktop', () => {
            render(
                <SessionSetRow
                    set={mockSet}
                    sIndex={0}
                    exIndex={0}
                    trackingType="weight_reps"
                    isOpenMenu={false}
                    onToggleMenu={vi.fn()}
                    onRemoveSet={vi.fn()}
                    onUpdateSet={vi.fn()}
                    onAddSpecialSet={vi.fn()}
                    onUpdateSpecialSet={vi.fn()}
                    onRemoveSpecialSet={vi.fn()}
                    onUpdateSetTarget={vi.fn()}
                />
            );

            const kgInput = screen.getByPlaceholderText('Kg') as HTMLInputElement;
            const repsInput = screen.getByPlaceholderText('Reps') as HTMLInputElement;

            const selectSpyKg = vi.spyOn(kgInput, 'select');
            const selectSpyReps = vi.spyOn(repsInput, 'select');

            // Simulate desktop click and focus
            fireEvent.click(kgInput);
            fireEvent.focus(kgInput);

            expect(selectSpyKg).toHaveBeenCalled();
            expect(scrollToSpy).not.toHaveBeenCalled();

            fireEvent.click(repsInput);
            fireEvent.focus(repsInput);

            expect(selectSpyReps).toHaveBeenCalled();
            expect(scrollToSpy).not.toHaveBeenCalled();
        });

        it('focusing time tracking inputs produces zero window.scrollTo calls', () => {
            const timeSet: SessionExerciseSet = {
                id: 'set-time-1',
                kg: '',
                reps: '',
                time: '60s'
            };

            render(
                <SessionSetRow
                    set={timeSet}
                    sIndex={0}
                    exIndex={0}
                    trackingType="time"
                    isOpenMenu={false}
                    onToggleMenu={vi.fn()}
                    onRemoveSet={vi.fn()}
                    onUpdateSet={vi.fn()}
                    onAddSpecialSet={vi.fn()}
                    onUpdateSpecialSet={vi.fn()}
                    onRemoveSpecialSet={vi.fn()}
                    onUpdateSetTarget={vi.fn()}
                />
            );

            const timeInput = screen.getByPlaceholderText('Tempo (es. 60s)') as HTMLInputElement;
            fireEvent.click(timeInput);
            fireEvent.focus(timeInput);

            expect(scrollToSpy).not.toHaveBeenCalled();
        });
    });

    describe('3. Intentional Scroll Preservation Verification', () => {
        it('preserves dropdown listbox keyboard scrollIntoView with block: nearest', () => {
            const mockExercises: ExerciseLibraryItem[] = [
                { id: '1', name: 'Panca piana', muscles: ['chest'], setsCount: 3, sets: [] },
                { id: '2', name: 'Squat', muscles: ['quads'], setsCount: 3, sets: [] },
                { id: '3', name: 'Stacco', muscles: ['back'], setsCount: 3, sets: [] }
            ];

            const scrollIntoViewMock = vi.fn();
            Element.prototype.scrollIntoView = scrollIntoViewMock;
            HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

            render(
                <ExerciseSearchDropdown
                    library={mockExercises}
                    onSelectExercise={vi.fn()}
                    placeholder="Cerca esercizio..."
                />
            );

            const input = screen.getByPlaceholderText('Cerca esercizio...');

            // Focusing input opens dropdown but does NOT trigger scrollIntoView on items
            fireEvent.focus(input);
            expect(scrollIntoViewMock).not.toHaveBeenCalled();

            // Arrow down key navigation triggers intentional scroll with block: nearest
            fireEvent.keyDown(input, { key: 'ArrowDown' });

            expect(scrollIntoViewMock).toHaveBeenCalledWith({
                block: 'nearest',
                behavior: 'smooth'
            });
            const activeId = input.getAttribute('aria-activedescendant');
            expect(activeId).toBeTruthy();
            expect(document.getElementById(activeId!)?.getAttribute('role')).toBe('option');
        });
        it('uses distinct listbox references for two mounted search controls', () => {
            const mockExercises: ExerciseLibraryItem[] = [{ id: '1', name: 'Squat', muscles: ['quads'], setsCount: 3, sets: [] }];
            render(<>
                <ExerciseSearchDropdown library={mockExercises} onSelectExercise={vi.fn()} placeholder="Cerca uno" />
                <ExerciseSearchDropdown library={mockExercises} onSelectExercise={vi.fn()} placeholder="Cerca due" />
            </>);
            const first = screen.getByPlaceholderText('Cerca uno');
            const second = screen.getByPlaceholderText('Cerca due');
            fireEvent.focus(first);
            fireEvent.focus(second);
            const firstId = first.getAttribute('aria-controls');
            const secondId = second.getAttribute('aria-controls');
            expect(firstId).toBeTruthy();
            expect(secondId).toBeTruthy();
            expect(firstId).not.toBe(secondId);
            expect(document.getElementById(firstId!)?.getAttribute('role')).toBe('listbox');
            expect(document.getElementById(secondId!)?.getAttribute('role')).toBe('listbox');
        });

    });
});
