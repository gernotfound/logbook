import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { emptyUserData } from '../../setup';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { useAppStore } from '../../../src/store/useAppStore';
import { captureSession } from '../../../src/lib/sync/session';
import { Logic } from '../../../src/lib/logic';
import { UserDataSchema, WorkoutSessionSchema } from '../../../src/lib/schema';
import SessionRatings from '../../../src/components/Training/session/SessionRatings';
import MuscleModel from '../../../src/components/Training/MuscleModel';
import { mergeActivePainsContract } from '../../system/requirements/requirements_r1_r6_contracts';

describe('Muscle pain tracking, UI and persistence', () => {
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

        describe('R5: DOMS Muscle Pain Tracking UI', () => {

            it('T1.5.1: UserDataSchema validates activePains array', () => {
                const data = {
                    ...emptyUserData,
                    activePains: ['petto', 'bicipiti', 'spalle']
                };
                const parsed = UserDataSchema.parse(data);
                expect((parsed as any).activePains).toEqual(['petto', 'bicipiti', 'spalle']);
            });


            it('T1.5.3: MuscleModel applies custom muscleColors for DOMS danger coloring', () => {
                const customColors = { 'chest-upper-left': '#ff4d6d' };
                const { container } = render(
                    <MuscleModel 
                        muscleColors={customColors} 
                        interactive={false} 
                    />
                );

                const chestPath = container.querySelector('[data-muscle-path="chest-upper-left"]');
                expect(chestPath).not.toBeNull();
                const style = chestPath?.getAttribute('style') || '';
                expect(style.includes('#ff4d6d') || style.includes('rgb(255, 77, 109)')).toBe(true);
            });

            it('T1.5.4: clicking muscle path in interactive mode invokes onToggleMuscle callback', () => {
                const mockToggle = vi.fn();
                const { container } = render(
                    <MuscleModel 
                        interactive={true} 
                        onToggleMuscle={mockToggle} 
                    />
                );

                const chestPath = container.querySelector('[data-muscle-path="chest-upper-left"]');
                expect(chestPath).not.toBeNull();
                fireEvent.click(chestPath!);
                expect(mockToggle).toHaveBeenCalledTimes(1);
                expect(mockToggle).toHaveBeenCalledWith(expect.any(String));
            });

            it('T1.5.5: SessionRatings renders post-workout rating fields (mood, pump, fatigue, water)', async () => {
                // SessionRatings mounts BufferedInput; keep a genuine unlocked device vault.
                await prepareUnlockedTestArchive('user:test-user-id');
                render(
                    <SessionRatings 
                        water="1.5"
                        setWater={vi.fn()}
                        mood="4"
                        setMood={vi.fn()}
                        pump="5"
                        setPump={vi.fn()}
                        fatigue="3"
                        setFatigue={vi.fn()}
                    />
                );

                expect(screen.getByDisplayValue('1.5')).toBeDefined();
                expect(screen.getByRole('button', { name: 'Umore: 4 su 5' }).getAttribute('aria-pressed')).toBe('true');
                expect(screen.getByRole('button', { name: 'Pump: 5 su 5' }).getAttribute('aria-pressed')).toBe('true');
                expect(screen.getByRole('button', { name: 'Stanchezza: 3 su 5' }).getAttribute('aria-pressed')).toBe('true');
            });



        });

        describe('R6: Persistenza esplicita dei dolori', () => {
            it('T1.6.1: keeps a pre-existing pain until explicitly cleared', () => {
                const activePains = ['petto'];
                const sessionPains: string[] = []; // User did not re-select petto

                const updated = mergeActivePainsContract(activePains, sessionPains);
                expect(updated).toEqual(['petto']); // Il dolore resta attivo finché l'utente non lo rimuove.
            });

            it('T1.6.2: preserves active pain if user explicitly re-selects it in session ratings', () => {
                const activePains = ['petto'];
                const sessionPains = ['petto']; // User re-selected petto

                const updated = mergeActivePainsContract(activePains, sessionPains);
                expect(updated).toEqual(['petto']);
            });

            it('T1.6.3: preserves multiple active pains in the absence of new reports', () => {
                const activePains = ['gambe', 'spalle'];
                const sessionPains: string[] = []; // Training does not imply that either active pain resolved.

                const updated = mergeActivePainsContract(activePains, sessionPains);
                expect(updated).toEqual(['gambe', 'spalle']);
            });

            it('T1.6.4: adds brand new pains selected during workout session evaluation', () => {
                const activePains = ['dorso'];
                const sessionPains = ['bicipiti']; // Newly experienced pain

                const updated = mergeActivePainsContract(activePains, sessionPains);
                expect(updated).toContain('dorso');
                expect(updated).toContain('bicipiti');
            });

            it('T1.6.6: WorkoutSessionSchema validates pains array on workout session history', () => {
                const session = {
                    date: '2026-08-20',
                    exercises: [],
                    pains: ['petto', 'tricipiti']
                };
                const parsed = WorkoutSessionSchema.parse(session);
                expect(parsed.pains).toEqual(['petto', 'tricipiti']);
            });

            it('T1.6.7: completing session without active pains simply adopts any newly added session pains', () => {
                const activePains: string[] = [];
                const sessionPains = ['femorali'];

                const updated = mergeActivePainsContract(activePains, sessionPains);
                expect(updated).toEqual(['femorali']);
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

        describe('R5: Boundary & Corner Cases', () => {
            it('T2.5.1: empty activePains array in UserData parses safely', () => {
                const parsed = UserDataSchema.parse({ ...emptyUserData, activePains: [] });
                expect((parsed as any).activePains).toEqual([]);
            });

            it('T2.5.2: omitted or undefined activePains normalizes to an empty array', () => {
                const withoutPains = { ...emptyUserData };
                delete withoutPains.activePains;
                expect(UserDataSchema.parse(withoutPains).activePains).toEqual([]);
                expect(UserDataSchema.parse({ ...emptyUserData, activePains: undefined }).activePains).toEqual([]);
            });

            it('T2.5.3: unknown muscle IDs do not highlight unrelated body paths', () => {
                const { container } = render(
                    <MuscleModel
                        selectedMuscles={['unknown_alien_muscle', 'fake_quad']}
                        interactive={false}
                    />
                );
                const paths = Array.from(container.querySelectorAll<SVGPathElement>('[data-muscle-path]'));
                expect(paths.length).toBeGreaterThan(20);
                for (const path of paths) {
                    expect(path.style.fill).toBe('var(--surface-light)');
                }
            });

            it('T2.5.4: duplicate muscle IDs in activePains list are handled safely', () => {
                const pains = ['petto', 'petto', 'petto'];
                const uniquePains = mergeActivePainsContract(pains, [' petto ', 'petto']);
                expect(uniquePains).toEqual(['petto']);
            });

            it('T2.5.5: all muscle groups active simultaneously renders full mannequin in danger state', () => {
                const allMuscles = Logic.MUSCLES.map(m => m.id);
                const colorMap = Object.fromEntries(allMuscles.map(m => [m, '#ff4d6d']));

                const { container } = render(
                    <MuscleModel
                        muscleColors={colorMap}
                        interactive={false}
                    />
                );

                const expectedPaths = new Set(allMuscles.flatMap(id => Logic.GROUP_MAP[id] ?? []));
                const highlighted = Array.from(container.querySelectorAll<SVGPathElement>('[data-muscle-path]'))
                    .filter(path => expectedPaths.has(path.dataset.musclePath ?? ''));
                expect(highlighted).toHaveLength(expectedPaths.size);
                expect(new Set(highlighted.map(path => path.dataset.musclePath))).toEqual(expectedPaths);
                for (const path of highlighted) {
                    expect(['#ff4d6d', 'rgb(255, 77, 109)']).toContain(path.style.fill);
                }
            });

            it('T2.5.8: two mounted muscle maps keep SVG ids unique and logical paths stable', () => {
                const { container } = render(
                    <>
                        <MuscleModel selectedMuscles={['petto']} />
                        <MuscleModel selectedMuscles={['petto']} />
                    </>
                );
                const ids = Array.from(container.querySelectorAll<HTMLElement>('[id]')).map(node => node.id);
                expect(ids.length).toBeGreaterThan(0);
                expect(new Set(ids).size).toBe(ids.length);
                expect(container.querySelectorAll('[data-muscle-path="chest-upper-left"]')).toHaveLength(2);
            });

            it('T2.5.6: validateWorkoutRatings validates numeric bounds (1-5)', () => {
                const valid = Logic.validateWorkoutRatings(4, 3, 5);
                expect(valid.isValid).toBe(true);
                expect(valid.mood).toBe(4);

                const invalid = Logic.validateWorkoutRatings(15, 0, -2);
                expect(invalid.isValid).toBe(false);
            });

            it('T2.5.7: validateWorkoutRatings accepts null or empty optional ratings', () => {
                const res = Logic.validateWorkoutRatings(null, undefined, '');
                expect(res.isValid).toBe(true);
                expect(res.mood).toBeNull();
            });
        });

        describe('R6: Boundary & Corner Cases', () => {
            it('T2.6.5: empty and whitespace-only reports do not delete active pains', () => {
                expect(mergeActivePainsContract(['petto'], ['', '  ', '     '])).toEqual(['petto']);
            });

            it('T2.6.6: session ratings where user selects multiple new pains deduplicates gracefully', () => {
                const activePains = ['petto'];
                const sessionPains = ['tricipiti', 'tricipiti', 'spalle'];

                const updated = mergeActivePainsContract(activePains, sessionPains);
                expect(updated).toEqual(['petto', 'tricipiti', 'spalle']);
                expect(activePains).toEqual(['petto']);
                expect(sessionPains).toEqual(['tricipiti', 'tricipiti', 'spalle']);
            });

            it('T2.6.7: mergeActivePains contract handles absent arguments as empty arrays', () => {
                expect(mergeActivePainsContract(undefined, undefined)).toEqual([]);
            });
        });
    });
});
