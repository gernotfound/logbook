import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { render, screen, fireEvent } from '@testing-library/react';
import SessionSetRow from '../../../src/components/Training/session/SessionSetRow';
import { useAppStore } from '../../../src/store/useAppStore';

describe('Workout set menu and nested segments', () => {
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

    describe('R4: SessionSetRow Special Button & Dropset Hierarchy', () => {


        it('expands special set menu and allows adding dropset or isometry', () => {
            const mockAdd = vi.fn();
            render(
                <SessionSetRow
                    set={{ id: 'set_1', kg: '80', reps: '8' }}
                    sIndex={0}
                    exIndex={0}
                    isOpenMenu={true}
                    onToggleMenu={vi.fn()}
                    onRemoveSet={vi.fn()}
                    onUpdateSet={vi.fn()}
                    onUpdateSetTarget={vi.fn()}
                    onAddSpecialSet={mockAdd}
                    onUpdateSpecialSet={vi.fn()}
                    onRemoveSpecialSet={vi.fn()}
                />
            );

            const dropsetOpt = screen.getByText('+ Dropset');
            fireEvent.click(dropsetOpt);
            expect(mockAdd).toHaveBeenCalledWith(0, 'dropset', 'set_1');

            const isometryOpt = screen.getByText('+ Isometria');
            fireEvent.click(isometryOpt);
            expect(mockAdd).toHaveBeenCalledWith(0, 'isometry', 'set_1');
        });

        it('renders nested dropsets and isometrics rows with proper change callbacks', async () => {
            await prepareUnlockedTestArchive('user:test-user-id');
            // Authenticated buffered drafts require the consent epoch already
            // published by a verified session, not the pre-launch raw fallback.
            window.localStorage.setItem('logbook:v2:user:test-user-id:health-consent-generation', '3');
            const mockUpdateSpecial = vi.fn();
            const mockRemoveSpecial = vi.fn();

            const set = {
                id: 'set_1',
                kg: '90',
                reps: '8',
                segments: [
                    { technique: 'dropset' as const, id: 'ds_1', kg: '70', reps: '8' },
                    { technique: 'isometry' as const, reps: '', id: 'iso_1', kg: '50', time: '20' }
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
                    onUpdateSetTarget={vi.fn()}
                    onAddSpecialSet={vi.fn()}
                    onUpdateSpecialSet={mockUpdateSpecial}
                    onRemoveSpecialSet={mockRemoveSpecial}
                />
            );

            expect(screen.getByText('↳ Dropset 1')).toBeDefined();
            expect(screen.getByText('↳ Isometria 1')).toBeDefined();

            const dsKgInput = screen.getByDisplayValue('70');
            fireEvent.change(dsKgInput, { target: { value: '75' } });
            fireEvent.blur(dsKgInput);
            expect(mockUpdateSpecial).toHaveBeenCalledWith(0, 'set_1', 'segments', 'ds_1', 'kg', '75');
        });
    });
});
