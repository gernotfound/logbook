import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { searchMuscles, mergeActivePains, createExerciseLibrarySearcher } from '../../../src/lib/calc/workout';
import SessionRatings from '../../../src/components/Training/session/SessionRatings';
import MuscleModel from '../../../src/components/Training/MuscleModel';
import HomeView from '../../../src/components/Home/HomeView';
import { useAppStore } from '../../../src/store/useAppStore';
import { renderWithProviders, defaultMockUserData } from '../../setup';

describe('Muscle pain UI and persistence', () => {
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

    describe('R5: DOMS Muscle Pain Tracking & Fuzzy Search Matrix', () => {

        it('searchMuscles correctly stems Italian plural/singular and matches muscles', () => {
            const pettorali = searchMuscles('pettorali');
            expect(pettorali.length).toBeGreaterThan(0);
            expect(pettorali.some(m => m.name.toLowerCase().includes('petto') || m.id.includes('chest'))).toBe(true);

            const deltoidi = searchMuscles('deltoidi');
            expect(deltoidi.length).toBeGreaterThan(0);
            expect(deltoidi.some(m => m.id.includes('delts') || m.name.toLowerCase().includes('deltoide'))).toBe(true);

            const bicipiti = searchMuscles('bicipiti');
            expect(bicipiti.length).toBeGreaterThan(0);
            expect(bicipiti.some(m => m.id.includes('biceps'))).toBe(true);

            const quadricipiti = searchMuscles('quadricipiti');
            expect(quadricipiti.length).toBeGreaterThan(0);
            expect(quadricipiti.some(m => m.id.includes('quad'))).toBe(true);
        });

        it('searchMuscles handles typos, partial strings, and case insensitivity', () => {
            const fuzzyPetto = searchMuscles('peto');
            expect(fuzzyPetto.length).toBeGreaterThan(0);

            const fuzzyBicipte = searchMuscles('bicipte');
            expect(fuzzyBicipte.length).toBeGreaterThan(0);

            const emptySearch = searchMuscles('');
            expect(emptySearch).toEqual([]);

            const whitespaceSearch = searchMuscles('   ');
            expect(whitespaceSearch).toEqual([]);
        });

        it('createExerciseLibrarySearcher finds exercises across names, stemmed names, muscles and notes', () => {
            const library = [
                { id: 'ex_1', name: 'Panca piana bilanciere', muscles: ['chest_upper_left', 'chest_upper_right'], notes: 'Presa media' },
                { id: 'ex_2', name: 'Trazioni presa prona', muscles: ['latissimus_dorsi_left'], notes: 'Zavorra' },
                { id: 'ex_3', name: 'Squat con bilanciere', muscles: ['quadriceps_left'], notes: 'Gambe' }
            ];

            const pancaRes = createExerciseLibrarySearcher(library)('pettorali');
            expect(pancaRes.length).toBeGreaterThan(0);
            expect(pancaRes[0].id).toBe('ex_1');

            const trazioniRes = createExerciseLibrarySearcher(library)('dorsali');
            expect(trazioniRes.length).toBeGreaterThan(0);
            expect(trazioniRes[0].id).toBe('ex_2');
        });

        it('MuscleModel renders interactive mannequin and highlights DOMS active pains in danger color', () => {
            const customColors = { 'chest-upper-left': '#ff4d6d', 'chest-upper-right': '#ff4d6d' };
            const { container } = render(
                <MuscleModel
                    muscleColors={customColors}
                    interactive={true}
                    onToggleMuscle={vi.fn()}
                />
            );

            const leftChest = container.querySelector('[data-muscle-path="chest-upper-left"]');
            expect(leftChest).not.toBeNull();
            const style = leftChest?.getAttribute('style') || '';
            expect(style.includes('#ff4d6d') || style.includes('rgb(255, 77, 109)')).toBe(true);
        });

        it('SessionRatings renders DOMS rating and evaluation fields', () => {
            render(
                <SessionRatings
                    water="2.0"
                    setWater={vi.fn()}
                    mood="4"
                    setMood={vi.fn()}
                    pump="5"
                    setPump={vi.fn()}
                    fatigue="5"
                    setFatigue={vi.fn()}
                />
            );

            expect(screen.getByDisplayValue('2.0')).toBeDefined();
            expect(screen.getByRole('button', { name: 'Umore: 4 su 5' }).getAttribute('aria-pressed')).toBe('true');
            expect(screen.getByRole('button', { name: 'Pump: 5 su 5' }).getAttribute('aria-pressed')).toBe('true');
            expect(screen.getByRole('button', { name: 'Stanchezza: 5 su 5' }).getAttribute('aria-pressed')).toBe('true');
        });

        it('HomeView displays Panoramica di oggi with activePains without crash', () => {
            const userData = {
                ...defaultMockUserData,
                activePains: ['chest', 'biceps_left']
            };
            renderWithProviders(<HomeView onNavigate={vi.fn()} />, { userData });
            expect(screen.getByText('TheLogBook')).toBeDefined();
            const activePainsToggle = screen.getByRole('button', { name: '2 dolori attivi' });
            expect(activePainsToggle.getAttribute('aria-expanded')).toBe('false');
            fireEvent.click(activePainsToggle);
            expect(activePainsToggle.getAttribute('aria-expanded')).toBe('true');
            expect(screen.getAllByRole('button', { name: /Rimuovi dolore/ })).toHaveLength(2);
        });
    });

    describe('R6: DOMS Explicit Persistence Logic - Pain and Laterality Scenarios', () => {

        it('preserves active pain when it is not re-reported after a session', () => {
            const activePains = ['chest', 'quadriceps'];
            const result = mergeActivePains(activePains, []);
            expect(result).toEqual(['chest', 'quadriceps']);
        });

        it('deduplicates previously active pain explicitly re-reported after a session', () => {
            const activePains = ['chest', 'quadriceps'];
            const sessionPains = ['chest']; // user still feels chest pain

            const result = mergeActivePains(activePains, sessionPains);
            expect(result).toEqual(['chest', 'quadriceps']);
        });

        it('adds newly reported session pains and merges with preserved pains', () => {
            const activePains = ['quadriceps'];
            const sessionPains = ['latissimus_dorsi', 'shoulders']; // new soreness

            const result = mergeActivePains(activePains, sessionPains);
            expect(result).toContain('quadriceps'); // preserved
            expect(result).toContain('latissimus_dorsi'); // new/re-selected
            expect(result).toContain('shoulders'); // new
        });

        it('preserves unilateral pain identifiers without implying bilateral recovery', () => {
            const activePains = ['chest_left', 'biceps'];
            const result = mergeActivePains(activePains, []);
            expect(result).toEqual(['chest_left', 'biceps']);
        });


        it('preserves all active pains and deduplicates reported ones', () => {
            const activePains = ['chest', 'triceps', 'shoulders_anterior', 'calves'];
            const result = mergeActivePains(activePains, ['triceps']);
            expect(result).toEqual(['chest', 'triceps', 'shoulders_anterior', 'calves']);
        });

        it('handles empty lists and corrupt pain entries without dropping valid pains', () => {
            expect(mergeActivePains([], [])).toEqual([]);
            expect(mergeActivePains(undefined as any, null as any)).toEqual([]);
            expect(mergeActivePains(['chest', '', null as any], [])).toEqual(['chest']);
        });
    });
});
