import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useAppStore } from '../../../src/store/useAppStore';
import SessionSetRow from '../../../src/components/Training/session/SessionSetRow';

describe('Session set actions and accessibility — boundary cases', () => {
    describe('Boundaries and corner cases', () => {
    beforeEach(() => {
        window.localStorage.clear();
        useAppStore.getState().resetStore();
        vi.clearAllMocks();
    });

    afterEach(() => {
        window.localStorage.clear();
        useAppStore.getState().resetStore();
        vi.restoreAllMocks();
    });

        describe('R4: Boundary & Corner Cases', () => {
            it('T2.4.1: rapid menu toggles in SessionSetRow do not throw or lose component state', () => {
                const mockToggle = vi.fn();
                const { rerender } = render(
                    <SessionSetRow 
                        set={{ id: 's1', kg: '80', reps: '10' }}
                        sIndex={0}
                        exIndex={0}
                        isOpenMenu={false}
                        onToggleMenu={mockToggle}
                        onRemoveSet={vi.fn()}
                        onUpdateSet={vi.fn()}
                        onAddSpecialSet={vi.fn()}
                        onUpdateSpecialSet={vi.fn()}
                        onRemoveSpecialSet={vi.fn()}
                    onUpdateSetTarget={vi.fn()}
                    />
                );

                const trigger = screen.getByRole('button', { name: 'Opzioni serie 1' });
                expect(trigger.getAttribute('aria-expanded')).toBe('false');
                fireEvent.click(trigger);
                expect(mockToggle).toHaveBeenCalledTimes(1);
                expect(mockToggle).toHaveBeenCalledWith('s1');

                rerender(
                    <SessionSetRow 
                        set={{ id: 's1', kg: '80', reps: '10' }}
                        sIndex={0}
                        exIndex={0}
                        isOpenMenu={true}
                        onToggleMenu={mockToggle}
                        onRemoveSet={vi.fn()}
                        onUpdateSet={vi.fn()}
                        onAddSpecialSet={vi.fn()}
                        onUpdateSpecialSet={vi.fn()}
                        onRemoveSpecialSet={vi.fn()}
                    onUpdateSetTarget={vi.fn()}
                    />
                );

                expect(screen.getByText('+ Dropset')).toBeDefined();
                expect(trigger.getAttribute('aria-expanded')).toBe('true');
                fireEvent.click(trigger);
                expect(mockToggle).toHaveBeenCalledTimes(2);
                expect(mockToggle).toHaveBeenLastCalledWith('s1');
            });

            it('T2.4.2: multiple dropsets display sequential labels "↳ Dropset 1", "↳ Dropset 2"', () => {
                const set = {
                    id: 's1',
                    kg: '100',
                    reps: '6',
                    segments: [
                        { technique: 'dropset' as const, id: 'ds1', kg: '80', reps: '6' },
                        { technique: 'dropset' as const, id: 'ds2', kg: '60', reps: '8' }
                    ]
                };
                render(
                    <SessionSetRow 
                        set={set}
                        sIndex={0}
                        exIndex={0}
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

                expect(screen.getByText('↳ Dropset 1')).toBeDefined();
                expect(screen.getByText('↳ Dropset 2')).toBeDefined();
            });

            it('T2.4.3: multiple isometrics display sequential labels "↳ Isometria 1", "↳ Isometria 2"', () => {
                const set = {
                    id: 's1',
                    kg: '50',
                    reps: '10',
                    segments: [
                        { technique: 'isometry' as const, reps: '', id: 'iso1', kg: '40', time: '20' },
                        { technique: 'isometry' as const, reps: '', id: 'iso2', kg: '30', time: '15' }
                    ]
                };
                render(
                    <SessionSetRow 
                        set={set}
                        sIndex={0}
                        exIndex={0}
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

                expect(screen.getByText('↳ Isometria 1')).toBeDefined();
                expect(screen.getByText('↳ Isometria 2')).toBeDefined();
            });

            it('T2.4.4: combining both dropset and isometry on the same set', () => {
                const set = {
                    id: 's1',
                    kg: '80',
                    reps: '8',
                    segments: [
                        { technique: 'dropset' as const, id: 'ds1', kg: '60', reps: '6' },
                        { technique: 'isometry' as const, reps: '', id: 'iso1', kg: '40', time: '15' }
                    ],
                };
                render(
                    <SessionSetRow 
                        set={set}
                        sIndex={0}
                        exIndex={0}
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

                expect(screen.getByText('↳ Dropset 1')).toBeDefined();
                expect(screen.getByText('↳ Isometria 1')).toBeDefined();
            });

            it('T2.4.5: clicking remove button on dropset invokes onRemoveSpecialSet', () => {
                const mockRemove = vi.fn();
                const set = {
                    id: 's1',
                    kg: '80',
                    reps: '8',
                    segments: [{ technique: 'dropset' as const, id: 'ds1', kg: '60', reps: '6' }]
                };
                render(
                    <SessionSetRow 
                        set={set}
                        sIndex={0}
                        exIndex={0}
                        isOpenMenu={false}
                        onToggleMenu={vi.fn()}
                        onRemoveSet={vi.fn()}
                        onUpdateSet={vi.fn()}
                        onAddSpecialSet={vi.fn()}
                        onUpdateSpecialSet={vi.fn()}
                        onRemoveSpecialSet={mockRemove}
                    onUpdateSetTarget={vi.fn()}
                    />
                );

                const removeBtn = screen.getByRole('button', { name: 'Rimuovi Dropset 1' });
                fireEvent.click(removeBtn);
                expect(mockRemove).toHaveBeenCalledWith(0, 's1', 'segments', 'ds1');
            });

            it('T2.4.6: SessionSetRow handles empty string kg and reps without throwing', () => {
                const set = { id: 's1', kg: '', reps: '' };
                const { container } = render(
                    <SessionSetRow
                        set={set}
                        sIndex={0}
                        exIndex={0}
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
                expect(container.querySelector<HTMLInputElement>('#kg-s1')?.value).toBe('');
                expect(container.querySelector<HTMLInputElement>('#reps-s1')?.value).toBe('');
                expect(screen.getByRole('button', { name: 'Opzioni serie 1' })).toBeDefined();
            });

            it('T2.4.7: delete set button aria-label includes set number for accessibility', () => {
                render(
                    <SessionSetRow 
                        set={{ id: 's3', kg: '50', reps: '10' }}
                        sIndex={2}
                        exIndex={0}
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

                expect(screen.getByRole('button', { name: 'Rimuovi serie 3' })).toBeDefined();
            });
        });
    });
});
