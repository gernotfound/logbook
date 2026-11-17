import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { useAppStore } from '../../../src/store/useAppStore';
import { captureSession } from '../../../src/lib/sync/session';
import SessionSetRow from '../../../src/components/Training/session/SessionSetRow';

describe('Session set actions and accessibility', () => {
    describe('Feature coverage', () => {
    beforeEach(async () => {
        window.localStorage.clear();
        localStorage.setItem(`logbook:v2:${captureSession().owner}:health-consent-generation`, '1');
        useAppStore.getState().resetStore();
        useAppStore.setState({ dataOwner: captureSession().owner });
        vi.clearAllMocks();
    });

    afterEach(() => {
        window.localStorage.clear();
        useAppStore.getState().resetStore();
        vi.restoreAllMocks();
    });

        describe('R4: Session Set Dot Vertical Centering', () => {
            beforeEach(async () => {
                await prepareUnlockedTestArchive('user:test-user-id');
            });

            it('T1.4.1: SessionSetRow renders S1 and an accessible options button', () => {
                const set = { id: 's1', kg: '80', reps: '10' };
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

                expect(screen.getByText('S1')).toBeDefined();
                const optionsBtn = screen.getByRole('button', { name: 'Opzioni serie 1' });
                expect(optionsBtn).toBeDefined();
                expect(optionsBtn.querySelector('svg')).not.toBeNull();
            });

            it('T1.4.2: clicking the ellipsis options button triggers onToggleMenu to open menu', () => {
                const mockToggle = vi.fn();
                render(
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

                const optionsBtn = screen.getByRole('button', { name: 'Opzioni serie 1' });
                fireEvent.click(optionsBtn);
                expect(mockToggle).toHaveBeenCalledTimes(1);
            });

            it('T1.4.3: when isOpenMenu is true, special menu shows "+ Dropset" and "+ Isometria" options', () => {
                const mockAdd = vi.fn();
                render(
                    <SessionSetRow 
                        set={{ id: 's1', kg: '80', reps: '10' }}
                        sIndex={0}
                        exIndex={0}
                        isOpenMenu={true}
                        onToggleMenu={vi.fn()}
                        onRemoveSet={vi.fn()}
                        onUpdateSet={vi.fn()}
                        onAddSpecialSet={mockAdd}
                        onUpdateSpecialSet={vi.fn()}
                        onRemoveSpecialSet={vi.fn()}
                    onUpdateSetTarget={vi.fn()}
                    />
                );

                const dropsetBtn = screen.getByText('+ Dropset');
                const isometryBtn = screen.getByText('+ Isometria');
                expect(dropsetBtn).toBeDefined();
                expect(isometryBtn).toBeDefined();

                fireEvent.click(dropsetBtn);
                expect(mockAdd).toHaveBeenCalledWith(0, 'dropset', 's1');
                fireEvent.click(isometryBtn);
                expect(mockAdd).toHaveBeenCalledWith(0, 'isometry', 's1');
            });

            it('edits a nested dropset without losing its parent-set identity', () => {
                const onUpdateSpecialSet = vi.fn();
                render(
                    <SessionSetRow
                        set={{
                            id: 's1', kg: '90', reps: '8',
                            segments: [
                                { technique: 'dropset', id: 'ds1', kg: '70', reps: '8' },
                                { technique: 'isometry', id: 'iso1', kg: '50', reps: '', time: '20' },
                            ],
                        }}
                        sIndex={0}
                        exIndex={0}
                        isOpenMenu={false}
                        onToggleMenu={vi.fn()}
                        onRemoveSet={vi.fn()}
                        onUpdateSet={vi.fn()}
                        onUpdateSetTarget={vi.fn()}
                        onAddSpecialSet={vi.fn()}
                        onUpdateSpecialSet={onUpdateSpecialSet}
                        onRemoveSpecialSet={vi.fn()}
                    />
                );
                expect(screen.getByText('↳ Dropset 1')).toBeDefined();
                expect(screen.getByText('↳ Isometria 1')).toBeDefined();
                const input = screen.getByDisplayValue('70');
                fireEvent.change(input, { target: { value: '75' } });
                fireEvent.blur(input);
                expect(onUpdateSpecialSet).toHaveBeenCalledWith(0, 's1', 'segments', 'ds1', 'kg', '75');
            });

            it('T1.4.4: renders Dropset rows beneath the parent set with kg and reps inputs', () => {
                const set = {
                    id: 's1',
                    kg: '100',
                    reps: '6',
                    segments: [{ technique: 'dropset' as const, id: 'ds1', kg: '80', reps: '6' }]
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
                expect(screen.getByDisplayValue('80')).toBeDefined();
            });

            it('T1.4.5: renders Isometria rows beneath parent set with kg and sec inputs', () => {
                const set = {
                    id: 's1',
                    kg: '50',
                    reps: '10',
                    segments: [{ technique: 'isometry' as const, reps: '', id: 'iso1', kg: '40', time: '30' }]
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
                expect(screen.getByDisplayValue('40')).toBeDefined();
                expect(screen.getByDisplayValue('30')).toBeDefined();
            });

            it('T1.4.6: supports time trackingType rendering time input placeholder', () => {
                const set = { id: 's1', kg: '', reps: '', time: '60s' };
                render(
                    <SessionSetRow 
                        set={set}
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

                expect(screen.getByPlaceholderText('Tempo (es. 60s)')).toBeDefined();
            });

            it('T1.4.7: typing into weight input invokes onUpdateSet with "kg" field and value', () => {
                localStorage.setItem(`logbook:v2:${captureSession().owner}:health-consent-generation`, '3');
                const mockUpdate = vi.fn();
                render(
                    <SessionSetRow 
                        set={{ id: 's1', kg: '70', reps: '10' }}
                        sIndex={0}
                        exIndex={0}
                        isOpenMenu={false}
                        onToggleMenu={vi.fn()}
                        onRemoveSet={vi.fn()}
                        onUpdateSet={mockUpdate}
                        onAddSpecialSet={vi.fn()}
                        onUpdateSpecialSet={vi.fn()}
                        onRemoveSpecialSet={vi.fn()}
                    onUpdateSetTarget={vi.fn()}
                    />
                );

                const kgInput = screen.getByDisplayValue('70');
                fireEvent.change(kgInput, { target: { value: '75' } });
                fireEvent.blur(kgInput);
                expect(mockUpdate).toHaveBeenCalledWith(0, 's1', 'kg', '75');
            });

            it('T1.4.8: keeps core segment fields but removes the segment technical-details section', () => {
                const set = {
                    id: 's1',
                    kg: '100',
                    reps: '8',
                    technique: 'cluster' as const,
                    segments: [
                        {
                        id: 'seg1',
                        kg: '73',
                        reps: '4',
                        restBeforeSeconds: 20
                    }
                    ]
                };

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

                expect(container.querySelector('#seg-kg-s1-seg1')).not.toBeNull();
                expect(container.querySelector('#seg-reps-s1-seg1')).not.toBeNull();
                expect(screen.queryByText('Dettagli tecnici segmento')).toBeNull();
                expect(screen.queryByText('Eccentrica (s)')).toBeNull();
                expect(screen.queryByText('Posizione tenuta')).toBeNull();
                expect(screen.queryByText('Assistenza')).toBeNull();
                expect(screen.queryByText('Solo negative')).toBeNull();
            });
        });
    });

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
                expect(() => render(
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
                )).not.toThrow();
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
