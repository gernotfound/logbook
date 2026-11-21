import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, emptyUserData } from '../../setup';
import { useAppStore } from '../../../src/store/useAppStore';
import TrainingExercises from '../../../src/components/Training/TrainingExercises';
import type { Exercise } from '../../../src/types';

describe('Exercise library editor and detail UI', () => {
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
    describe('TrainingExercises Component UI', () => {
        it('renders isBodyweight checkbox and equipmentWeight input when trackingType is weight_reps', () => {
            renderWithProviders(<TrainingExercises />, { userData: emptyUserData });

            const createBtn = screen.getByRole('button', { name: /Crea esercizio/i });
            fireEvent.click(createBtn);

            const bwCheckbox = screen.getByLabelText(/Esercizio a corpo libero/i) as HTMLInputElement;
            expect(bwCheckbox).toBeDefined();
            expect(bwCheckbox.type).toBe('checkbox');
            expect(bwCheckbox.checked).toBe(false);
            fireEvent.click(bwCheckbox);
            expect(bwCheckbox.checked).toBe(true);

            const eqInput = screen.getByPlaceholderText('0') as HTMLInputElement;
            expect(eqInput).toBeDefined();
            expect(eqInput.type).toBe('number');
            fireEvent.change(eqInput, { target: { value: '12.5' } });
            expect(eqInput.value).toBe('12.5');
        });

        it('renders the compact proposal-5 exercise list without legacy badges', () => {
            const initialLibrary: Exercise[] = [
                {
                    id: 'ex-1',
                    name: 'Trazioni alla sbarra',
                    setsCount: 4,
                    sets: [],
                    trackingType: 'weight_reps',
                    isBodyweight: true
                },
                {
                    id: 'ex-2',
                    name: 'Panca piana bilanciere',
                    setsCount: 4,
                    sets: [],
                    trackingType: 'weight_reps',
                    equipmentWeight: 20
                }
            ];

            renderWithProviders(<TrainingExercises />, {
                userData: {
                    ...emptyUserData,
                    library: initialLibrary
                }
            });

            expect(screen.getByRole('heading', { name: 'La tua libreria' })).toBeDefined();
            expect(screen.getByRole('button', { name: 'Apri dettaglio di Trazioni alla sbarra' })).toBeDefined();
            expect(screen.queryByText('Corpo libero')).toBeNull();
            expect(screen.queryByText('Attrezzo: 20 kg')).toBeNull();
        });

        it('opens the dedicated detail page with real exercise metadata', () => {
            const initialLibrary: Exercise[] = [
                {
                    id: 'ex-dips',
                    name: 'Dip alle parallele zavorrate',
                    setsCount: 3,
                    sets: [],
                    trackingType: 'weight_reps',
                    muscles: ['chest'],
                    secondaryMuscles: ['triceps'],
                    notes: 'Scapole stabili',
                    isDefault: false,
                    isBodyweight: true,
                    equipmentWeight: 5
                }
            ];

            const { container } = renderWithProviders(<TrainingExercises />, {
                userData: {
                    ...emptyUserData,
                    library: initialLibrary
                }
            });

            fireEvent.click(screen.getByRole('button', { name: 'Apri dettaglio di Dip alle parallele zavorrate' }));

            expect(screen.getByRole('region', { name: 'Dettaglio esercizio' })).toBeDefined();
            expect(screen.getByText('Peso e ripetizioni')).toBeDefined();
            expect(screen.getByText('Personale')).toBeDefined();
            expect(screen.getByText('Scapole stabili')).toBeDefined();
            expect(screen.getByRole('button', { name: 'Torna all’elenco' })).toBeDefined();
            expect(container.querySelector('.muscle-map-container')).not.toBeNull();
        });
    });
});
