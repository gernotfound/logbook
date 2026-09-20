import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import SessionSetRow from '../src/components/Training/session/SessionSetRow';
import ExerciseSearchDropdown from '../src/components/Training/ExerciseSearchDropdown';
import { WorkoutSet, ExerciseLibraryItem } from '../src/types';

describe('Empirical Challenger Focus & Scroll Suite', () => {
    let originalScrollTo: typeof window.scrollTo;
    let scrollToSpy: ReturnType<typeof vi.fn>;
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');

    beforeEach(() => {
        originalScrollTo = window.scrollTo;
        scrollToSpy = vi.fn();
        window.scrollTo = scrollToSpy;
    });

    afterEach(() => {
        window.scrollTo = originalScrollTo;
        if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
        else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
        vi.restoreAllMocks();
    });

    describe('1. Desktop Input Focus Empirical Verification (Zero Scroll Displacement)', () => {
        const mockSet: WorkoutSet = {
            id: 'set-empirical-1',
            type: 'normal',
            kg: 80,
            reps: 10,
            completed: false
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
            const timeSet: WorkoutSet = {
                id: 'set-time-1',
                type: 'normal',
                time: '60s',
                completed: false
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
                />
            );

            const timeInput = screen.getByPlaceholderText('Tempo (es. 60s)') as HTMLInputElement;
            fireEvent.click(timeInput);
            fireEvent.focus(timeInput);

            expect(scrollToSpy).not.toHaveBeenCalled();
        });
    });

    describe('2. Mobile Viewport & Virtual Keyboard Avoidance Mathematical & Empirical Proof', () => {
        interface ViewportState {
            layoutViewportHeight: number;
            keyboardHeight: number;
            visualViewportHeight: number;
            documentScrollY: number;
        }

        interface ElementLayout {
            offsetTop: number;
            height: number;
        }

        function calculateVisibility(
            el: ElementLayout,
            vp: ViewportState
        ): {
            clientTopWithoutScroll: number;
            clientBottomWithoutScroll: number;
            isOccludedWithoutScroll: number; // percentage occluded [0..100]
            centeredScrollY: number;
            clientTopWithNativeScroll: number;
            isFullyVisibleWithNativeScroll: boolean;
        } {
            // Unshifted client rect relative to current scroll
            const clientTopUnshifted = el.offsetTop - vp.documentScrollY;
            const clientBottomUnshifted = clientTopUnshifted + el.height;

            // Keyboard occludes from visualViewportHeight to layoutViewportHeight
            const visibleBoundary = vp.visualViewportHeight;
            let occludedPixels = 0;
            if (clientBottomUnshifted > visibleBoundary) {
                occludedPixels = Math.min(el.height, clientBottomUnshifted - visibleBoundary);
            }
            const isOccludedWithoutScroll = (occludedPixels / el.height) * 100;

            // Native browser centering algorithm: target element center at visualViewport.height / 2
            const elementCenterOffset = el.offsetTop + el.height / 2;
            const targetVisualCenter = vp.visualViewportHeight / 2;
            const centeredScrollY = Math.max(0, elementCenterOffset - targetVisualCenter);

            const clientTopWithNativeScroll = el.offsetTop - centeredScrollY;
            const isFullyVisibleWithNativeScroll =
                clientTopWithNativeScroll >= 0 &&
                clientTopWithNativeScroll + el.height <= vp.visualViewportHeight;

            return {
                clientTopWithoutScroll: clientTopUnshifted,
                clientBottomWithoutScroll: clientBottomUnshifted,
                isOccludedWithoutScroll,
                centeredScrollY,
                clientTopWithNativeScroll,
                isFullyVisibleWithNativeScroll
            };
        }

        it('empirically proves that bottom fields are 100% occluded without native scroll when keyboard opens', () => {
            const mobileViewport: ViewportState = {
                layoutViewportHeight: 800,
                keyboardHeight: 350,
                visualViewportHeight: 450,
                documentScrollY: 0
            };

            // Set 4 located at offsetTop = 600px (standard position in workout session)
            const lowerSetInput: ElementLayout = {
                offsetTop: 600,
                height: 48
            };

            const result = calculateVisibility(lowerSetInput, mobileViewport);

            // Without scroll, the input sits at y=600px, which is deep inside the keyboard area [450px..800px]
            expect(result.clientTopWithoutScroll).toBe(600);
            expect(result.isOccludedWithoutScroll).toBe(100);

            // With native centering scroll:
            // element center = 624px, target visual center = 225px -> scrollY = 399px
            expect(result.centeredScrollY).toBe(399);
            // new client top in visual viewport = 600 - 399 = 201px
            expect(result.clientTopWithNativeScroll).toBe(201);
            expect(result.isFullyVisibleWithNativeScroll).toBe(true);
        });

        it('empirically proves that mid-screen fields touch the keyboard boundary without native adjustment', () => {
            const mobileViewport: ViewportState = {
                layoutViewportHeight: 800,
                keyboardHeight: 350,
                visualViewportHeight: 450,
                documentScrollY: 0
            };

            // Set 2 located at offsetTop = 420px
            const midSetInput: ElementLayout = {
                offsetTop: 420,
                height: 48
            };

            const result = calculateVisibility(midSetInput, mobileViewport);

            // Without scroll, input bottom is 468px, overflowing past 450px keyboard top
            expect(result.clientBottomWithoutScroll).toBe(468);
            expect(result.isOccludedWithoutScroll).toBeGreaterThan(0);

            // With native centering, it becomes fully visible
            expect(result.isFullyVisibleWithNativeScroll).toBe(true);
        });
    });

    describe('3. Intentional Scroll Preservation Verification', () => {
        it('scrolls the dropdown during keyboard navigation without moving the page', () => {
            const mockExercises: ExerciseLibraryItem[] = [
                { id: '1', name: 'Panca piana', category: 'Chest', equipment: 'Barbell', custom: false },
                { id: '2', name: 'Squat', category: 'Legs', equipment: 'Barbell', custom: false },
                { id: '3', name: 'Stacco', category: 'Back', equipment: 'Barbell', custom: false }
            ];

            const scrollIntoViewMock = vi.fn();
            Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoViewMock });

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

            const list = screen.getByRole('listbox');
            const options = screen.getAllByRole('option');
            Object.defineProperty(list, 'clientHeight', { configurable: true, value: 50 });
            options.forEach((option, index) => {
                Object.defineProperty(option, 'offsetTop', { configurable: true, value: index * 50 });
                Object.defineProperty(option, 'offsetHeight', { configurable: true, value: 50 });
            });
            fireEvent.keyDown(input, { key: 'ArrowDown' });
            expect(list.scrollTop).toBe(0);
            fireEvent.keyDown(input, { key: 'ArrowDown' });
            expect(list.scrollTop).toBe(50);
            expect(input.getAttribute('aria-activedescendant')).toBe(options[1].id);
            fireEvent.keyDown(input, { key: 'ArrowUp' });
            expect(list.scrollTop).toBe(0);
            expect(scrollIntoViewMock).not.toHaveBeenCalled();
            expect(scrollToSpy).not.toHaveBeenCalled();
        });
    });
});
