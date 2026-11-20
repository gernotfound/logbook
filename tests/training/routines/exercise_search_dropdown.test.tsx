import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { mockLibrary } from './exerciseSearchTestFixture';
import { ExerciseSearchDropdown } from '../../../src/components/Training/ExerciseSearchDropdown';
import type { ExerciseLibraryItem } from '../../../src/types';

    describe('2. ExerciseSearchDropdown Component Interactions', () => {
        it('2.1: Renders input with 16px font-size and Italian sentence case placeholder', () => {
            const onSelect = vi.fn();
            const { container } = render(
                <ExerciseSearchDropdown
                    library={mockLibrary}
                    onSelectExercise={onSelect}
                    placeholder="🔍 Cerca esercizio da aggiungere..."
                />
            );

            const input = container.querySelector('input') as HTMLInputElement;
            expect(input).not.toBeNull();
            expect(input.placeholder).toBe('🔍 Cerca esercizio da aggiungere...');
            expect(input.style.fontSize).toBe('16px');
            // Dropdown list is not open initially
            expect(container.querySelector('[role="listbox"]')).toBeNull();
        });

        it('2.1a: exposes a stable accessible name for the exercise combobox', () => {
            render(<ExerciseSearchDropdown library={mockLibrary} onSelectExercise={vi.fn()} />);
            expect(screen.getByRole('combobox', { name: 'Cerca esercizio' })).toBeDefined();
        });

        it('2.2: Focusing/clicking input opens floating dropdown list', () => {
            const onSelect = vi.fn();
            const { container } = render(
                <ExerciseSearchDropdown
                    library={mockLibrary}
                    onSelectExercise={onSelect}
                />
            );

            const input = container.querySelector('input') as HTMLInputElement;
            fireEvent.focus(input);

            const listbox = container.querySelector('[role="listbox"]');
            expect(listbox).not.toBeNull();
            const items = container.querySelectorAll('.exercise-dropdown-item');
            expect(items.length).toBe(mockLibrary.length);
        });

        it('2.3: Typing in input filters dropdown items in real-time', () => {
            const onSelect = vi.fn();
            const { container } = render(
                <ExerciseSearchDropdown
                    library={mockLibrary}
                    onSelectExercise={onSelect}
                />
            );

            const input = container.querySelector('input') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'squat' } });

            const items = container.querySelectorAll('.exercise-dropdown-item');
            expect(items.length).toBe(1);
            expect(items[0].textContent).toContain('Squat con Bilanciere');
        });

        it('2.4: Renders tracking badges (Cardio, Tempo, Muscle category)', () => {
            const onSelect = vi.fn();
            const { container } = render(
                <ExerciseSearchDropdown
                    library={mockLibrary}
                    onSelectExercise={onSelect}
                />
            );

            const input = container.querySelector('input') as HTMLInputElement;
            fireEvent.focus(input);

            expect(container.textContent).toContain('Cardio');
            expect(container.textContent).toContain('Tempo');
            expect(container.textContent).toContain('Petto');
            expect(container.textContent).toContain('Dorso');
        });

        it('2.5: Clicking an item calls onSelectExercise, clears input, and closes dropdown', () => {
            const onSelect = vi.fn();
            const { container } = render(
                <ExerciseSearchDropdown
                    library={mockLibrary}
                    onSelectExercise={onSelect}
                />
            );

            const input = container.querySelector('input') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'trazioni' } });

            const item = container.querySelector('.exercise-dropdown-item') as HTMLElement;
            expect(item).not.toBeNull();
            fireEvent.click(item);

            expect(onSelect).toHaveBeenCalledWith('ex_pullup');
            expect(input.value).toBe('');
            expect(container.querySelector('[role="listbox"]')).toBeNull();
        });

        it('2.6: Clear button (✕) empties input and resets search', () => {
            const onSelect = vi.fn();
            const { container } = render(
                <ExerciseSearchDropdown
                    library={mockLibrary}
                    onSelectExercise={onSelect}
                />
            );

            const input = container.querySelector('input') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'panca' } });

            const clearBtn = container.querySelector('button[aria-label="Cancella ricerca"]') as HTMLButtonElement;
            expect(clearBtn).not.toBeNull();
            fireEvent.click(clearBtn);

            expect(input.value).toBe('');
        });

        it('2.7: Keyboard navigation: ArrowDown, ArrowUp, Enter to select', () => {
            const onSelect = vi.fn();
            const { container } = render(
                <ExerciseSearchDropdown
                    library={mockLibrary}
                    onSelectExercise={onSelect}
                />
            );

            const input = container.querySelector('input') as HTMLInputElement;
            fireEvent.focus(input);

            // The empty-query list is sorted alphabetically: Corsa, Panca Inclinata, ...
            fireEvent.keyDown(input, { key: 'ArrowDown' });
            fireEvent.keyDown(input, { key: 'ArrowDown' });
            fireEvent.keyDown(input, { key: 'ArrowUp' });
            fireEvent.keyDown(input, { key: 'ArrowDown' });
            fireEvent.keyDown(input, { key: 'Enter' });

            expect(onSelect).toHaveBeenCalledExactlyOnceWith('ex_incline');
            expect(container.querySelector('[role="listbox"]')).toBeNull();
        });

        it('2.8: Escape key closes the dropdown and blurs input', () => {
            const onSelect = vi.fn();
            const { container } = render(
                <ExerciseSearchDropdown
                    library={mockLibrary}
                    onSelectExercise={onSelect}
                />
            );

            const input = container.querySelector('input') as HTMLInputElement;
            fireEvent.focus(input);
            input.focus();
            expect(document.activeElement).toBe(input);
            expect(container.querySelector('[role="listbox"]')).not.toBeNull();

            fireEvent.keyDown(input, { key: 'Escape' });
            expect(container.querySelector('[role="listbox"]')).toBeNull();
            expect(document.activeElement).not.toBe(input);
        });

        it('2.9: Clicking outside closes the dropdown', () => {
            const onSelect = vi.fn();
            const { container } = render(
                <div>
                    <div data-testid="outside-area">Spazio Esterno</div>
                    <ExerciseSearchDropdown
                        library={mockLibrary}
                        onSelectExercise={onSelect}
                    />
                </div>
            );

            const input = container.querySelector('input') as HTMLInputElement;
            fireEvent.focus(input);
            expect(container.querySelector('[role="listbox"]')).not.toBeNull();

            const outside = screen.getByTestId('outside-area');
            fireEvent.mouseDown(outside);

            expect(container.querySelector('[role="listbox"]')).toBeNull();
        });

        it('2.10: Empty state message rendered when no matches found', () => {
            const onSelect = vi.fn();
            const { container } = render(
                <ExerciseSearchDropdown
                    library={mockLibrary}
                    onSelectExercise={onSelect}
                />
            );

            const input = container.querySelector('input') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'zzzzzz_non_esistente_qqqqq' } });

            expect(container.textContent).toContain('Nessun esercizio trovato');
        });

        it('2.11: ExcludeIds prop filters out specified exercises from dropdown', () => {
            const onSelect = vi.fn();
            const { container } = render(
                <ExerciseSearchDropdown
                    library={mockLibrary}
                    onSelectExercise={onSelect}
                    excludeIds={['ex_bench', 'ex_squat']}
                />
            );

            const input = container.querySelector('input') as HTMLInputElement;
            fireEvent.focus(input);

            const items = container.querySelectorAll('.exercise-dropdown-item');
            expect(items.length).toBe(mockLibrary.length - 2);
            expect(container.textContent).not.toContain('Panca Piana Bilanciere');
            expect(container.textContent).not.toContain('Squat con Bilanciere');
        });
        it('2.12: renders a bounded list and reveals the remaining results only on scroll', () => {
            const largeLibrary: ExerciseLibraryItem[] = Array.from({ length: 95 }, (_, index) => ({
                id: `large-${index + 1}`,
                name: index === 94 ? 'Speciale corpo libero' : `Esercizio ${String(index + 1).padStart(3, '0')}`,
                muscles: [],
                setsCount: 3,
                sets: [],
            }));
            const { container } = render(<ExerciseSearchDropdown library={largeLibrary} onSelectExercise={vi.fn()} />);
            const input = container.querySelector('input') as HTMLInputElement;
            expect(container.querySelector('[role="listbox"]')).toBeNull();

            fireEvent.focus(input);
            const listbox = container.querySelector('[role="listbox"]') as HTMLElement;
            expect(listbox.querySelectorAll('[role="option"]')).toHaveLength(40);
            expect(listbox.querySelector('[role="option"]')?.getAttribute('aria-setsize')).toBe('95');

            Object.defineProperties(listbox, {
                scrollTop: { configurable: true, value: 200 },
                clientHeight: { configurable: true, value: 200 },
                scrollHeight: { configurable: true, value: 350 },
            });
            fireEvent.scroll(listbox);
            expect(listbox.querySelectorAll('[role="option"]')).toHaveLength(80);
            fireEvent.scroll(listbox);
            expect(listbox.querySelectorAll('[role="option"]')).toHaveLength(95);

            fireEvent.change(input, { target: { value: 'speciale' } });
            expect(listbox.querySelectorAll('[role="option"]')).toHaveLength(1);
            expect(listbox.textContent).toContain('Speciale corpo libero');
            fireEvent.change(input, { target: { value: '' } });
            expect(listbox.querySelectorAll('[role="option"]')).toHaveLength(40);
        });

        it('2.13: keyboard wrap expands the list before referring to the last option', () => {
            const largeLibrary: ExerciseLibraryItem[] = Array.from({ length: 95 }, (_, index) => ({
                id: `key-${index + 1}`,
                name: `Esercizio ${String(index + 1).padStart(3, '0')}`,
                muscles: [],
                setsCount: 3,
                sets: [],
            }));
            const onSelect = vi.fn();
            const { container } = render(<ExerciseSearchDropdown library={largeLibrary} onSelectExercise={onSelect} />);
            const input = container.querySelector('input') as HTMLInputElement;
            fireEvent.focus(input);
            expect(container.querySelectorAll('[role="option"]')).toHaveLength(40);

            fireEvent.keyDown(input, { key: 'ArrowUp' });
            const activeId = input.getAttribute('aria-activedescendant');
            expect(activeId).toBeTruthy();
            expect(document.getElementById(activeId!)?.getAttribute('role')).toBe('option');
            expect(container.querySelectorAll('[role="option"]')).toHaveLength(95);
            fireEvent.keyDown(input, { key: 'Enter' });
            expect(onSelect).toHaveBeenCalledExactlyOnceWith('key-95');
        });

        it('2.14: clears stale keyboard selection if the catalog changes while open', () => {
            const onSelect = vi.fn();
            const firstLibrary: ExerciseLibraryItem[] = [
                { id: 'original-a', name: 'Alzate laterali', muscles: [], setsCount: 3, sets: [] },
                { id: 'original-b', name: 'Panca piana', muscles: [], setsCount: 3, sets: [] },
                { id: 'original-c', name: 'Squat', muscles: [], setsCount: 3, sets: [] },
            ];
            const updatedLibrary: ExerciseLibraryItem[] = [
                { id: 'replacement-a', name: 'Affondi', muscles: [], setsCount: 3, sets: [] },
                { id: 'replacement-b', name: 'Curl', muscles: [], setsCount: 3, sets: [] },
                { id: 'replacement-c', name: 'Plank', muscles: [], setsCount: 3, sets: [] },
            ];
            const { rerender } = render(
                <ExerciseSearchDropdown library={firstLibrary} onSelectExercise={onSelect} />
            );
            const input = screen.getByRole('combobox', { name: 'Cerca esercizio' });
            fireEvent.focus(input);
            fireEvent.keyDown(input, { key: 'ArrowDown' });
            expect(input.getAttribute('aria-activedescendant')).toBeTruthy();

            rerender(<ExerciseSearchDropdown library={updatedLibrary} onSelectExercise={onSelect} />);
            expect(input.getAttribute('aria-activedescendant')).toBeNull();
            fireEvent.keyDown(input, { key: 'Enter' });
            expect(onSelect).not.toHaveBeenCalled();

            fireEvent.keyDown(input, { key: 'ArrowDown' });
            fireEvent.keyDown(input, { key: 'Enter' });
            expect(onSelect).toHaveBeenCalledExactlyOnceWith('replacement-a');
        });

        it('2.15: clears stale keyboard selection when exclusions change without replacing the library', () => {
            const onSelect = vi.fn();
            const { rerender } = render(
                <ExerciseSearchDropdown library={mockLibrary} onSelectExercise={onSelect} />
            );
            const input = screen.getByRole('combobox', { name: 'Cerca esercizio' });
            fireEvent.focus(input);
            fireEvent.keyDown(input, { key: 'ArrowDown' });
            expect(input.getAttribute('aria-activedescendant')).toBeTruthy();

            rerender(<ExerciseSearchDropdown
                library={mockLibrary}
                excludeIds={['ex_bench']}
                onSelectExercise={onSelect}
            />);
            expect(input.getAttribute('aria-activedescendant')).toBeNull();
            fireEvent.keyDown(input, { key: 'Enter' });
            expect(onSelect).not.toHaveBeenCalled();
        });
    })
