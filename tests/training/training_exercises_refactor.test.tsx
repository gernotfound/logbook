import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders, mockFirebaseAuth } from '../setup';
import { ownerUiPreferenceKey } from '../../src/lib/uiPreferenceKeys';

const mocks = vi.hoisted(() => ({
    useTrainingExercises: vi.fn(),
}));

vi.mock('../../src/hooks/useTrainingExercises', () => ({
    useTrainingExercises: mocks.useTrainingExercises,
}));

vi.mock('../../src/components/Training/MuscleModel', () => ({
    default: ({ interactive }: { interactive?: boolean }) => <div data-testid="muscle-model" data-interactive={String(interactive)} />,
}));

import TrainingExercises from '../../src/components/Training/TrainingExercises';

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
            handleCancelEdit: vi.fn(() => true),
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

    it('does not close the editor if protected draft cleanup fails', () => {
        renderWithProviders(<TrainingExercises />);
        const hook = mocks.useTrainingExercises.mock.results[0].value;
        hook.handleCancelEdit.mockReturnValue(false);
        fireEvent.click(screen.getByRole('button', { name: 'Crea esercizio' }));
        fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }));
        expect(hook.handleCancelEdit).toHaveBeenCalledOnce();
        expect(screen.getByRole('heading', { level: 2, name: 'Nuovo esercizio' })).toBeDefined();
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


    it('keeps the creation draft and all controls locked until save completes', async () => {
        let resolveSave!: (result: boolean) => void;
        const hook = mocks.useTrainingExercises();
        hook.handleSaveExercise
            .mockImplementationOnce(() => new Promise<boolean>(resolve => { resolveSave = resolve; }))
            .mockResolvedValue(true);
        renderWithProviders(<TrainingExercises />);

        fireEvent.click(screen.getByRole('button', { name: 'Crea esercizio' }));
        const save = screen.getByRole('button', { name: 'Salva' });
        fireEvent.click(save);

        expect(hook.handleSaveExercise).toHaveBeenCalledOnce();
        expect((screen.getByLabelText('Nome esercizio') as HTMLInputElement).disabled).toBe(true);
        expect((screen.getByLabelText('Note di setup') as HTMLInputElement).disabled).toBe(true);
        expect((screen.getByRole('button', { name: 'Cardio' }) as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByLabelText(/Esercizio a corpo libero/) as HTMLInputElement).disabled).toBe(true);
        expect((screen.getByLabelText(/Peso attrezzo, espresso in kg/) as HTMLInputElement).disabled).toBe(true);
        expect((screen.getByRole('button', { name: 'Primari' }) as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByRole('searchbox', { name: 'Seleziona muscoli dall’elenco' }) as HTMLInputElement).disabled).toBe(true);
        expect(screen.getByTestId('muscle-model').getAttribute('data-interactive')).toBe('false');
        expect((screen.getByRole('button', { name: 'Chiudi' }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Salvataggio…' }));
        fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }));
        expect(hook.handleSaveExercise).toHaveBeenCalledOnce();
        expect(hook.handleCancelEdit).not.toHaveBeenCalled();

        await act(async () => { resolveSave(false); });
        expect(screen.getByRole('heading', { name: 'Nuovo esercizio' })).toBeDefined();
        expect((screen.getByLabelText('Nome esercizio') as HTMLInputElement).disabled).toBe(false);
        expect(screen.getByTestId('muscle-model').getAttribute('data-interactive')).toBe('true');
        fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
        await waitFor(() => expect(screen.queryByRole('heading', { name: 'Nuovo esercizio' })).toBeNull());
        expect(hook.handleSaveExercise).toHaveBeenCalledTimes(2);
    });

    it('serializes restore and save on an existing catalog exercise', async () => {
        let resolveRestore!: () => void;
        let resolveSave!: (result: boolean) => void;
        const hook = {
            ...mocks.useTrainingExercises(),
            editingExId: 'catalog-ex',
            library: [{
                id: 'catalog-ex', name: 'Esercizio catalogo',
                setsCount: 3, sets: [], isDefault: true,
            }],
        };
        hook.handleRestoreExercise.mockImplementationOnce(
            () => new Promise<void>(resolve => { resolveRestore = resolve; })
        );
        hook.handleSaveExercise.mockImplementationOnce(
            () => new Promise<boolean>(resolve => { resolveSave = resolve; })
        );
        mocks.useTrainingExercises.mockReturnValue(hook);
        renderWithProviders(<TrainingExercises />);

        fireEvent.click(screen.getByRole('button', { name: 'Ripristina originale' }));
        expect(hook.handleRestoreExercise).toHaveBeenCalledOnce();
        expect((screen.getByRole('button', { name: 'Ripristina originale' }) as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByRole('button', { name: 'Salvataggio…' }) as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByLabelText('Nome esercizio') as HTMLInputElement).disabled).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Ripristina originale' }));
        fireEvent.click(screen.getByRole('button', { name: 'Salvataggio…' }));
        expect(hook.handleRestoreExercise).toHaveBeenCalledOnce();
        expect(hook.handleSaveExercise).not.toHaveBeenCalled();

        await act(async () => { resolveRestore(); });
        expect((screen.getByRole('button', { name: 'Ripristina originale' }) as HTMLButtonElement).disabled).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
        expect(hook.handleSaveExercise).toHaveBeenCalledOnce();
        fireEvent.click(screen.getByRole('button', { name: 'Ripristina originale' }));
        expect(hook.handleRestoreExercise).toHaveBeenCalledOnce();
        await act(async () => { resolveSave(false); });
        expect((screen.getByRole('button', { name: 'Ripristina originale' }) as HTMLButtonElement).disabled).toBe(false);
    });
});
