import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useAppStore } from '../src/store/useAppStore';
import HomeDomsCard from '../src/components/Home/widgets/HomeDomsCard';
import SessionRatings from '../src/components/Training/session/SessionRatings';
import { useWorkoutSession } from '../src/hooks/useWorkoutSession';
import { renderHook } from '@testing-library/react';
import type { UserData, WorkoutSession } from '../src/types';

const baseUserData: UserData = {
    profile: { gender: 'M', height: 180 },
    library: [
        { id: 'ex_bench', name: 'Panca piana', muscles: ['chest'], setsCount: 3, sets: [] },
        { id: 'ex_squat', name: 'Squat con bilanciere', muscles: ['quads'], setsCount: 3, sets: [] },
        { id: 'ex_curls', name: 'Curl bicipiti', muscles: ['biceps'], setsCount: 3, sets: [] }
    ],
    routines: [
        {
            id: 'r_push',
            name: 'Push Day',
            exercises: [
                { exId: 'ex_bench', setsCount: 3 }
            ]
        }
    ],
    history: [],
    nutrition: {},
    customFoods: [],
    activeWorkout: null,
    activePains: ['chest', 'quads']
};

describe('DOMS R5 & R6 Full Component and Integration Suite', () => {
    beforeEach(() => {
        window.localStorage.clear();
        useAppStore.setState({
            userData: JSON.parse(JSON.stringify(baseUserData)),
            localWorkout: null
        });
        vi.clearAllMocks();
    });

    afterEach(() => {
        window.localStorage.clear();
        useAppStore.getState().resetStore();
        vi.restoreAllMocks();
    });

    describe('HomeDomsCard (R5 UI)', () => {
        it('renders active pain badges with localized names and count', () => {
            const toggleMock = vi.fn();
            render(
                <HomeDomsCard 
                    activePains={['chest', 'quads']}
                    painColors={{ chest: '#ef4444', quads: '#ef4444' }}
                    onTogglePain={toggleMock}
                />
            );

            expect(screen.getByText('Dolori muscolari')).toBeDefined();
            expect(screen.getByText('2 attivi')).toBeDefined();
            expect(screen.getByText('Petto')).toBeDefined();
            expect(screen.getByText('Quadricipiti')).toBeDefined();
        });

        it('allows searching muscles and adding a new muscle to active pains', () => {
            const toggleMock = vi.fn();
            render(
                <HomeDomsCard 
                    activePains={['chest']}
                    painColors={{ chest: '#ef4444' }}
                    onTogglePain={toggleMock}
                />
            );

            const input = screen.getByPlaceholderText('🔍 Cerca muscolo dolorante...');
            fireEvent.change(input, { target: { value: 'bicipiti' } });

            const addBtn = screen.getByRole('button', { name: /Bicipiti/i });
            expect(addBtn).toBeDefined();
            fireEvent.click(addBtn);
            expect(toggleMock).toHaveBeenCalledWith('biceps');
        });

        it('allows removing active pain via badge ✕ button', () => {
            const toggleMock = vi.fn();
            render(
                <HomeDomsCard 
                    activePains={['chest']}
                    painColors={{ chest: '#ef4444' }}
                    onTogglePain={toggleMock}
                />
            );

            const removeBtn = screen.getByRole('button', { name: 'Rimuovi dolore Petto' });
            fireEvent.click(removeBtn);
            expect(toggleMock).toHaveBeenCalledWith('chest');
        });

        it('renders helpful empty state when no active pains exist', () => {
            render(
                <HomeDomsCard 
                    activePains={[]}
                    painColors={{}}
                    onTogglePain={vi.fn()}
                />
            );

            expect(screen.getByText('0 attivi')).toBeDefined();
            expect(screen.getByText(/Nessun dolore muscolare registrato/i)).toBeDefined();
        });
    });

    describe('SessionRatings DOMS Accordion (R5 UI)', () => {
        it('renders collapsed accordion by default and expands upon click', () => {
            render(
                <SessionRatings 
                    water="1.5"
                    setWater={vi.fn()}
                    mood="8"
                    setMood={vi.fn()}
                    pump="9"
                    setPump={vi.fn()}
                    fatigue="5"
                    setFatigue={vi.fn()}
                    pains={['chest']}
                    onTogglePain={vi.fn()}
                />
            );

            expect(screen.getByText('1 selezionati')).toBeDefined();
            const accordionBtn = screen.getByRole('button', { name: /Dolori muscolari/i });
            
            // Before clicking: search input is not visible
            expect(screen.queryByPlaceholderText('🔍 Cerca muscolo dolorante...')).toBeNull();

            // Click to open
            fireEvent.click(accordionBtn);

            // After opening: search input and mannequin are visible
            expect(screen.getByPlaceholderText('🔍 Cerca muscolo dolorante...')).toBeDefined();
            expect(screen.getByText('Petto')).toBeDefined();
        });

        it('handles search and selection inside SessionRatings accordion', () => {
            const toggleMock = vi.fn();
            render(
                <SessionRatings 
                    water=""
                    setWater={vi.fn()}
                    mood=""
                    setMood={vi.fn()}
                    pump=""
                    setPump={vi.fn()}
                    fatigue=""
                    setFatigue={vi.fn()}
                    pains={[]}
                    onTogglePain={toggleMock}
                />
            );

            const accordionBtn = screen.getByRole('button', { name: /Dolori muscolari/i });
            fireEvent.click(accordionBtn);

            const searchInput = screen.getByPlaceholderText('🔍 Cerca muscolo dolorante...');
            fireEvent.change(searchInput, { target: { value: 'deltoidi' } });

            const options = screen.getAllByRole('button', { name: /Deltoide anteriore/i });
            expect(options.length).toBeGreaterThan(0);
            fireEvent.click(options[0]);
            expect(toggleMock).toHaveBeenCalled();
        });
    });

    describe('useWorkoutSession Auto-Healing Workflow (R6 Logic)', () => {
        it('endWorkout heals trained primary muscles left unselected in session ratings', async () => {
            // Setup active workout with Bench Press (Primary: chest)
            const activeSession: WorkoutSession = {
                id: 'ws_test_1',
                routineId: 'r_push',
                routineName: 'Push Day',
                date: '2026-08-20',
                globalStartTime: Date.now() - 3600000,
                exercises: [
                    {
                        id: 'se_1',
                        exId: 'ex_bench',
                        sets: [{ id: 's_1', kg: '80', reps: '10' }]
                    }
                ],
                pains: [] // Chest not re-selected (healed!)
            };

            useAppStore.setState({
                userData: {
                    ...baseUserData,
                    activePains: ['chest', 'quads']
                },
                localWorkout: activeSession
            });

            const { result } = renderHook(() => useWorkoutSession());

            // Mock showConfirm to return true
            vi.spyOn(window, 'confirm').mockReturnValue(true);

            await act(async () => {
                await result.current.endWorkout();
            });

            const updatedUserData = useAppStore.getState().userData;
            // 'chest' was trained and left out of pains -> HEALED
            // 'quads' was not trained -> PRESERVED
            expect(updatedUserData?.activePains).toEqual(['quads']);

            // Local workout cleared
            expect(useAppStore.getState().localWorkout).toBeNull();

            // History updated
            expect(updatedUserData?.history?.length).toBe(1);
        });

        it('endWorkout preserves trained muscle if explicitly re-selected in session pains', async () => {
            const activeSession: WorkoutSession = {
                id: 'ws_test_2',
                routineId: 'r_push',
                routineName: 'Push Day',
                date: '2026-08-20',
                globalStartTime: Date.now() - 3600000,
                exercises: [
                    {
                        id: 'se_1',
                        exId: 'ex_bench',
                        sets: [{ id: 's_1', kg: '80', reps: '10' }]
                    }
                ],
                pains: ['chest'] // Re-selected!
            };

            useAppStore.setState({
                userData: {
                    ...baseUserData,
                    activePains: ['chest', 'quads']
                },
                localWorkout: activeSession
            });

            const { result } = renderHook(() => useWorkoutSession());

            await act(async () => {
                await result.current.endWorkout();
            });

            const updatedUserData = useAppStore.getState().userData;
            expect(updatedUserData?.activePains).toEqual(['chest', 'quads']);
        });

        it('endWorkout adds brand new pain reported at end of session', async () => {
            const activeSession: WorkoutSession = {
                id: 'ws_test_3',
                routineId: 'r_push',
                routineName: 'Push Day',
                date: '2026-08-20',
                globalStartTime: Date.now() - 3600000,
                exercises: [
                    {
                        id: 'se_1',
                        exId: 'ex_bench',
                        sets: [{ id: 's_1', kg: '80', reps: '10' }]
                    }
                ],
                pains: ['biceps'] // New pain reported
            };

            useAppStore.setState({
                userData: {
                    ...baseUserData,
                    activePains: ['quads']
                },
                localWorkout: activeSession
            });

            const { result } = renderHook(() => useWorkoutSession());

            await act(async () => {
                await result.current.endWorkout();
            });

            const updatedUserData = useAppStore.getState().userData;
            expect(updatedUserData?.activePains).toContain('quads');
            expect(updatedUserData?.activePains).toContain('biceps');
        });
    });
});
