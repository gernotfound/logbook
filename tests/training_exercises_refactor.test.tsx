import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from './setup';

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
            handleEditClick: vi.fn(),
            handleCancelEdit: vi.fn(),
            handleSaveExercise: vi.fn().mockResolvedValue(true),
            handleDelete: vi.fn(),
            handleRestoreExercise: vi.fn(),
            handleDuplicate: vi.fn(),
        });
    });

    it('opens and cancels the creation form through the existing reset callback', () => {
        renderWithProviders(<TrainingExercises />);
        const hook = mocks.useTrainingExercises.mock.results[0].value;

        const createButton = screen.getByRole('button', { name: /Crea esercizio/i });
        expect(createButton.getAttribute('aria-expanded')).toBe('false');

        fireEvent.click(createButton);
        expect(screen.getByRole('heading', { level: 2, name: /Crea nuovo esercizio/i })).toBeDefined();
        expect(screen.getByTestId('muscle-model')).toBeDefined();

        fireEvent.click(screen.getByRole('button', { name: /Annulla/i }));
        expect(hook.handleCancelEdit).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('heading', { level: 2, name: /Crea nuovo esercizio/i })).toBeNull();
    });
});
