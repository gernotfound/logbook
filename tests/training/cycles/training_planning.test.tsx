import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TrainingPlanning from '../../../src/components/Training/planning/TrainingPlanning';
import TrainingSession from '../../../src/components/Training/TrainingSession';
import TrainingView from '../../../src/components/Training/TrainingView';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { captureSession } from '../../../src/lib/sync/session';
import { markTabSnapshotClean } from '../../../src/lib/sync/tabSnapshotCausality';
import { initializeLocal } from '../../../src/lib/sync/localRepository';
import { useAppStore } from '../../../src/store/useAppStore';
import type { UserData } from '../../../src/types';
import { createTrainingPlanningFixtures } from './trainingPlanningFixtures';

describe('Training Planning & Volume Calculations', () => {
    const { mockLibrary, mockRoutines } = createTrainingPlanningFixtures();

    describe('TrainingPlanning UI Component', () => {
        beforeEach(() => {
            localStorage.setItem('logbook:v2:user:test-user-id:health-consent-generation', '1');
            const initialUserData: UserData = {
                library: mockLibrary,
                routines: mockRoutines,
                trainingCycles: [
                    {
                        id: 'cycle_active',
                        name: 'Mesociclo Massa',
                        durationWeeks: 8,
                        notes: 'Focus petto e spalle',
                        routines: [
                            { routineId: 'r_push', frequencyPerWeek: 2 },
                            { routineId: 'r_pull', frequencyPerWeek: 1 }
                        ],
                        isActive: true
                    }
                ],
                activeCycleId: 'cycle_active'
            };
            useAppStore.setState({ userData: initialUserData, dataOwner: 'user:test-user-id', localWorkout: null });
            markTabSnapshotClean(captureSession(), initialUserData);
        });

        it('renders active cycle, MuscleModel, and weekly volume list', () => {
            render(<TrainingPlanning />);

            expect(screen.getByRole('button', { name: /Crea ciclo/i })).toBeDefined();
            expect(screen.getAllByText(/Mesociclo Massa/).length).toBeGreaterThanOrEqual(1);
            expect(screen.getAllByText(/8 settimane/).length).toBeGreaterThanOrEqual(1);
            expect(screen.getAllByText(/Focus petto e spalle/).length).toBeGreaterThanOrEqual(1);
            expect(screen.getAllByText('Obiettivo non specificato').length).toBeGreaterThanOrEqual(1);

            fireEvent.click(screen.getByRole('button', { name: 'Dettagli ciclo' }));

            // Muscle model present
            const muscleModel = document.querySelector('.planning-active-details .cycle-muscle-map-model svg');
            expect(muscleModel).not.toBeNull();
            expect(muscleModel?.querySelectorAll('path').length).toBeGreaterThan(0);

            // Volume section: bottone accordion deve essere presente
            const volumeBtn = screen.getByRole('button', { name: 'Volume settimanale per macroarea' });
            expect(volumeBtn).toBeDefined();

            // Apertura della tendina per verificare il contenuto del volume
            fireEvent.click(volumeBtn);
            expect(screen.getByText('Petto')).toBeDefined();
            expect(screen.getByText('Spalle')).toBeDefined();
        });

        it('allows opening cycle editor and creating a new cycle', async () => {
            render(<TrainingPlanning />);

            const newBtn = screen.getByRole('button', { name: /Crea ciclo/i });
            fireEvent.click(newBtn);

            expect(screen.getByRole('heading', { name: /Crea ciclo di allenamento/ })).toBeDefined();

            const nameInput = screen.getByPlaceholderText('Es. Mesociclo ipertrofia 4 giorni');
            fireEvent.change(nameInput, { target: { value: 'Nuovo Ciclo Forza' } });

            // Select a routine and declare the cycle strategy.
            const selectRoutine = screen.getByRole('combobox', { name: /Aggiungi scheda alla sequenza/i });
            fireEvent.change(selectRoutine, { target: { value: 'r_push' } });
            fireEvent.click(screen.getByRole('button', { name: 'Sviluppo' }));
            fireEvent.click(screen.getByRole('button', { name: 'Performance' }));
            const primarySearch = screen.getByRole('combobox', { name: 'Cerca focus primario' });
            fireEvent.focus(primarySearch);
            fireEvent.change(primarySearch, { target: { value: 'quadricipiti' } });
            fireEvent.click(screen.getByRole('option', { name: 'Quadricipiti' }));

            const secondarySearch = screen.getByRole('combobox', { name: 'Cerca focus secondario' });
            fireEvent.focus(secondarySearch);
            fireEvent.change(secondarySearch, { target: { value: 'tricipiti' } });
            fireEvent.click(screen.getByRole('option', { name: 'Tricipiti' }));

            const saveBtn = screen.getByText(/Salva ciclo/i);
            fireEvent.click(saveBtn);

            await waitFor(() => {
                const cycles = useAppStore.getState().userData?.trainingCycles || [];
                const created = cycles.find(c => c.name === 'Nuovo Ciclo Forza');
                expect(created?.strategy).toEqual({
                    intent: 'development',
                    progressionFocus: 'performance',
                    primaryMuscles: ['quads'],
                    secondaryMuscles: ['triceps']
                });
            });
        });

        it('exposes accessible intent/focus controls without forcing muscle priorities', () => {
            render(<TrainingPlanning />);
            fireEvent.click(screen.getByRole('button', { name: /Crea ciclo/i }));

            expect(screen.getByRole('group', { name: 'Intento del ciclo' })).toBeDefined();
            const unspecified = screen.getByRole('button', { name: 'Non specificato' });
            expect(unspecified.getAttribute('aria-pressed')).toBe('true');

            const primarySearch = screen.getByRole('combobox', { name: 'Cerca focus primario' }) as HTMLInputElement;
            expect(primarySearch.disabled).toBe(false);
            fireEvent.focus(primarySearch);
            expect(screen.getByRole('listbox', { name: 'Risultati focus primario' })).toBeDefined();

            fireEvent.click(screen.getByRole('button', { name: 'Mantenimento' }));
            expect(screen.queryByRole('group', { name: 'Focus principale della progressione' })).toBeNull();

            fireEvent.click(screen.getByRole('button', { name: 'Deload' }));
            expect(screen.queryByRole('group', { name: 'Focus principale della progressione' })).toBeNull();

            fireEvent.click(screen.getByRole('button', { name: 'Sviluppo' }));
            expect(screen.getByRole('group', { name: 'Focus principale della progressione' })).toBeDefined();
        });

        it('updates the draft muscle map as routines are selected without saving the cycle', () => {
            const originalCycles = useAppStore.getState().userData?.trainingCycles;
            render(<TrainingPlanning />);

            const createButton = screen.getByRole('button', { name: /Crea ciclo/i });
            fireEvent.click(createButton);
            const form = document.getElementById('cycle-editor-form');
            const map = form?.querySelector('.cycle-muscle-map');
            expect(map?.textContent).toContain('Nessun muscolo evidenziato');

            fireEvent.change(screen.getByRole('combobox', { name: /Aggiungi scheda alla sequenza/i }), { target: { value: 'r_push' } });
            expect(map?.querySelector('.muscle-legend')?.textContent).toContain('Petto');
            expect(useAppStore.getState().userData?.trainingCycles).toEqual(originalCycles);

            fireEvent.click(createButton);
            expect(document.getElementById('cycle-editor-form')).toBeNull();
        });

        it('supports duplicating and deleting a cycle while preserving its strategy', async () => {
            const current = useAppStore.getState().userData!;
            useAppStore.setState({
                dataOwner: 'user:test-user-id',
                userData: {
                    ...current,
                    trainingCycles: current.trainingCycles?.map(cycle => ({
                        ...cycle,
                        strategy: { intent: 'development', progressionFocus: 'volume' },
                    })),
                },
            });
            render(<TrainingPlanning />);

            // Open ContextMenu for the active cycle and duplicate
            const optionsBtn = screen.getByTitle('Opzioni');
            fireEvent.click(optionsBtn);

            const dupBtn = screen.getByRole('menuitem', { name: /Duplica/i });
            fireEvent.click(dupBtn);

            await waitFor(() => {
                const cycles = useAppStore.getState().userData?.trainingCycles || [];
                const duplicate = cycles.find(c => c.name.includes('- 1'));
                expect(duplicate?.strategy).toEqual({ intent: 'development', progressionFocus: 'volume' });
            });

            // Open ContextMenu for the second cycle and delete it
            const allOptionsBtns = screen.getAllByTitle('Opzioni');
            expect(allOptionsBtns.length).toBeGreaterThanOrEqual(2);
            fireEvent.click(allOptionsBtns[1]);

            const deleteBtn = screen.getByRole('menuitem', { name: /Elimina/i });
            fireEvent.click(deleteBtn);

            await waitFor(() => {
                const cycles = useAppStore.getState().userData?.trainingCycles || [];
                expect(cycles.length).toBe(1);
            });
        });

        it('scrolls to top and opens editor when clicking Modifica on a cycle', () => {
            const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
            render(<TrainingPlanning />);

            const optionsBtn = screen.getByTitle('Opzioni');
            fireEvent.click(optionsBtn);

            const editBtn = screen.getByRole('menuitem', { name: /Modifica/i });
            fireEvent.click(editBtn);

            expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
            expect(screen.getByText(/Modifica ciclo/)).toBeDefined();
            scrollToSpy.mockRestore();
        });

        it('lets an already-used cycle change strategy without rewriting historical session context', async () => {
            const current = useAppStore.getState().userData!;
            useAppStore.setState({
                dataOwner: 'user:test-user-id',
                userData: {
                    ...current,
                    trainingCycles: current.trainingCycles?.map(cycle => cycle.id === 'cycle_active'
                        ? {
                            ...cycle,
                            strategy: { intent: 'development', progressionFocus: 'performance' }
                        }
                        : cycle),
                    history: [{
                        id: 'history-cycle-strategy',
                        cycleId: 'cycle_active',
                        cycleName: 'Mesociclo Massa',
                        cycleStrategy: { intent: 'development', progressionFocus: 'performance' },
                        date: '2026-09-10',
                        exercises: []
                    }]
                }
            });

            render(<TrainingPlanning />);
            fireEvent.click(screen.getByTitle('Opzioni'));
            fireEvent.click(screen.getByRole('menuitem', { name: /Modifica/i }));

            expect(screen.getByText(/sessioni future; le sessioni già registrate non vengono riscritte/i)).toBeDefined();
            fireEvent.click(screen.getByRole('button', { name: 'Volume' }));
            fireEvent.click(screen.getByRole('button', { name: /Salva modifiche/i }));

            await waitFor(() => {
                const data = useAppStore.getState().userData!;
                expect(data.trainingCycles?.find(cycle => cycle.id === 'cycle_active')?.strategy?.progressionFocus).toBe('volume');
                expect(data.history?.[0]?.cycleStrategy?.progressionFocus).toBe('performance');
            });
        });

        it('supports activating and deactivating a training cycle', async () => {
            render(<TrainingPlanning />);

            // Check deactivation button
            const deactivateBtn = screen.getByText(/Disattiva ciclo/i);
            fireEvent.click(deactivateBtn);

            await waitFor(() => {
                expect(useAppStore.getState().userData?.activeCycleId).toBeNull();
            });

            // Reactivate cycle
            const activateBtn = screen.getByText(/Imposta come ciclo attivo/i);
            fireEvent.click(activateBtn);

            await waitFor(() => {
                expect(useAppStore.getState().userData?.activeCycleId).toBe('cycle_active');
            });
        });

        it('renders the optional suggested routine in TrainingSession and starts it', async () => {
            localStorage.setItem('logbook:v2:user:test-user-id:health-consent-generation', '1');
            await prepareUnlockedTestArchive('user:test-user-id');
            await initializeLocal('user:test-user-id', useAppStore.getState().userData!);
            render(<TrainingSession />);

            expect(screen.getByText(/Scheda suggerita · Rotazione flessibile/i)).toBeDefined();
            expect(screen.getAllByText(/Mesociclo Massa/).length).toBeGreaterThanOrEqual(1);

            // Check next scheduled routine button
            const startPlannedBtn = screen.getByText(/Avvia Spinta \(Push\) \(Seduta #/i);
            fireEvent.click(startPlannedBtn);

            await waitFor(() => {
                const active = useAppStore.getState().localWorkout;
                expect(active).not.toBeNull();
                expect(active?.routineName).toBe('Spinta (Push)');
                expect(active?.cycleId).toBe('cycle_active');
            });
        });

        it('allows selecting another routine from the rotation dropdown and starting it', async () => {
            localStorage.setItem('logbook:v2:user:test-user-id:health-consent-generation', '1');
            await prepareUnlockedTestArchive('user:test-user-id');
            await initializeLocal('user:test-user-id', useAppStore.getState().userData!);
            render(<TrainingSession />);

            const select = screen.getByRole('combobox', { name: /Seleziona scheda della rotazione/i });
            // Select routine 'r_pull' (Trazione (Pull))
            fireEvent.change(select, { target: { value: 'r_pull' } });

            // Button should display and allow starting Trazione (Pull)
            const startSelectedBtn = screen.getByRole('button', { name: /Avvia Trazione \(Pull\)/i });
            expect(startSelectedBtn).toBeDefined();

            fireEvent.click(startSelectedBtn);

            await waitFor(() => {
                const active = useAppStore.getState().localWorkout;
                expect(active).not.toBeNull();
                expect(active?.routineName).toBe('Trazione (Pull)');
                expect(active?.cycleId).toBe('cycle_active');
            });
        });

        it('shows message and navigation to planning when no active cycle is set', () => {
            useAppStore.setState({
                dataOwner: 'user:test-user-id',
                userData: {
                    ...useAppStore.getState().userData!,
                    activeCycleId: null
                }
            });

            const onNavPlanning = vi.fn();
            render(<TrainingSession onNavigateToPlanning={onNavPlanning} />);

            expect(screen.getByText(/Nessun ciclo di allenamento attivo al momento/i)).toBeDefined();
            const navBtn = screen.getByRole('button', { name: /Vai a Pianificazione/i });
            fireEvent.click(navBtn);
            expect(onNavPlanning).toHaveBeenCalled();
        });

        it('integrates seamlessly inside TrainingView under subTab planning', async () => {
            const setSubTab = vi.fn();
            render(<TrainingView subTab="planning" setSubTab={setSubTab} />);

            expect(screen.getAllByText(/Pianificazione/).length).toBeGreaterThanOrEqual(1);
            expect((await screen.findAllByText('Mesociclo Massa')).length).toBeGreaterThanOrEqual(1);

            // Check sub nav buttons
            const subNavBtns = screen.getAllByText(/Sessione|Pianificazione|Schede|Esercizi|Storico/);
            expect(subNavBtns.length).toBeGreaterThanOrEqual(5);
        });
    });

});
