import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders, mockFirebaseAuth } from './setup';
import { ownerUiPreferenceKey } from '../src/lib/uiPreferenceKeys';

const mocks = vi.hoisted(() => ({
    useTrainingExercises: vi.fn(),
}));

vi.mock('../src/hooks/useTrainingExercises', () => ({
    useTrainingExercises: mocks.useTrainingExercises,
}));

vi.mock('../src/components/Training/MuscleModel', () => ({
    default: () => <div data-testid="muscle-model" />,
}));

import TrainingExercises from '../src/components/Training/TrainingExercises';

describe('TrainingExercises decomposition parity', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
        mocks.useTrainingExercises.mockReturnValue({
            editingExId: null,
            exName: '',
            setExName: vi.fn(),
            exNotes: '',
            setExNotes: vi.fn(),
            muscleSearch: '',
            setMuscleSearch: vi.fn(),
            selectedMuscles: [],
            secondaryMuscles: [],
            selectionMode: 'primary',
            setSelectionMode: vi.fn(),
            isDuplicateName: false,
            library: [],
            routines: [],
            filteredMuscles: [],
            trackingType: 'weight_reps',
            setTrackingType: vi.fn(),
            isBodyweight: false,
            setIsBodyweight: vi.fn(),
            equipmentWeight: '',
            setEquipmentWeight: vi.fn(),
            toggleMuscle: vi.fn(),
            handleToggleMuscleById: vi.fn(),
            removeMuscleById: vi.fn(),
            handleEditClick: vi.fn(),
            handleCancelEdit: vi.fn(),
            handleSaveExercise: vi.fn().mockResolvedValue(true),
            handleDelete: vi.fn(),
            handleRestoreExercise: vi.fn(),
            handleDuplicate: vi.fn(),
        });
    });

    it('does not resume an exercise creation from a previous account', () => {
        localStorage.setItem('logbook_creating_exercise', 'true');
        localStorage.setItem(ownerUiPreferenceKey('user:previous', 'creating-exercise'), 'true');
        const first = renderWithProviders(<TrainingExercises />);
        expect(screen.getByRole('button', { name: 'Crea esercizio' })).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: 'Crea esercizio' }));
        expect(localStorage.getItem(ownerUiPreferenceKey('user:test-user-id', 'creating-exercise'))).toBe('true');
        first.unmount();

        if (!mockFirebaseAuth.currentUser) throw new Error('Test authentication fixture missing');
        mockFirebaseAuth.currentUser = { ...mockFirebaseAuth.currentUser, uid: 'new-account' };
        renderWithProviders(<TrainingExercises />);
        expect(screen.getByRole('button', { name: 'Crea esercizio' })).toBeDefined();
        expect(screen.queryByRole('heading', { name: 'Nuovo esercizio' })).toBeNull();
    });

    it('opens and cancels the creation form through the existing reset callback', () => {
        renderWithProviders(<TrainingExercises />);
        const hook = mocks.useTrainingExercises.mock.results[0].value;

        const createButton = screen.getByRole('button', { name: /Crea esercizio/i });
        fireEvent.click(createButton);
        expect(screen.getByRole('heading', { level: 2, name: /Nuovo esercizio/i })).toBeDefined();
        expect(screen.getByTestId('muscle-model')).toBeDefined();
        expect(screen.getByRole('button', { name: 'Chiudi' })).toBeDefined();

        fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }));
        expect(hook.handleCancelEdit).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('heading', { level: 2, name: /Nuovo esercizio/i })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: /Crea esercizio/i }));
        fireEvent.click(screen.getByRole('button', { name: /Annulla/i }));
        expect(hook.handleCancelEdit).toHaveBeenCalledTimes(2);
    });
});
