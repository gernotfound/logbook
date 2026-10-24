import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, render, cleanup, waitFor } from '@testing-library/react';
import WeeklyVolumeChart from '../src/components/analytics/WeeklyVolumeChart';
import { Chart as ChartJS } from 'chart.js';
import { getLocalDateString } from '../src/lib/utils/date';
import VolumeCaloriesCorrelationChart from '../src/components/analytics/VolumeCaloriesCorrelationChart';

import {   computeVolumeCaloriesCorrelation, calculatePearsonCorrelation, generateWeekIntervals } from '../src/lib/calc/analytics';
import type { WorkoutSession, NutritionDay, Exercise } from '../src/types';

describe('Challenger 2: UI/UX Adversarial & Responsive Stress Test Suite', () => {
    const mockLibrary: Exercise[] = [
        {
            id: 'ex_bench',
            name: 'Panca piana',
            muscles: ['petto'],
            secondaryMuscles: ['tricipiti', 'spalle'],
            trackingType: 'weight_reps',
            setsCount: 3,
            sets: []
        },
        {
            id: 'ex_squat',
            name: 'Squat con bilanciere',
            muscles: ['quadricipiti'],
            secondaryMuscles: ['glutei'],
            trackingType: 'weight_reps',
            setsCount: 3,
            sets: []
        },
        {
            id: 'ex_pullup',
            name: 'Trazioni alla sbarra',
            muscles: ['dorso'],
            secondaryMuscles: ['bicipiti'],
            trackingType: 'weight_reps',
            isBodyweight: true,
            setsCount: 3,
            sets: []
        }
    ];

    // Relative to the test clock: these suites must not expire on a future date.
    const recentDate = (weeksAgo: number, dayOffset = 0): string => {
        const date = new Date();
        date.setHours(12, 0, 0, 0);
        date.setDate(date.getDate() - 7 * weeksAgo + dayOffset);
        return getLocalDateString(date);
    };

    const generateRealisticHistory = (): WorkoutSession[] => [
        {
            id: 'sess_1',
            date: recentDate(3),
            routineName: 'Upper Body A',
            exercises: [
                {
                    exId: 'ex_bench',
                    sessionNote: '',
                    sets: [
                        { id: 's1', kg: '100', reps: '10', done: true },
                        { id: 's2', kg: '100', reps: '10', done: true, dropsets: [{ id: 'd1', kg: '70', reps: '8' }] }
                    ]
                }
            ]
        },
        {
            id: 'sess_2',
            date: recentDate(2),
            routineName: 'Upper Body A',
            exercises: [
                {
                    exId: 'ex_bench',
                    sessionNote: '',
                    sets: [
                        { id: 's3', kg: '105', reps: '10', done: true },
                        { id: 's4', kg: '105', reps: '8', done: true }
                    ]
                }
            ]
        },
        {
            id: 'sess_3',
            date: recentDate(1),
            routineName: 'Upper Body A',
            exercises: [
                {
                    exId: 'ex_bench',
                    sessionNote: '',
                    sets: [
                        { id: 's5', kg: '110', reps: '8', done: true },
                        { id: 's6', kg: '110', reps: '8', done: true }
                    ]
                }
            ]
        }
    ];

    const generateRealisticNutrition = (): Record<string, NutritionDay> => ({
        [recentDate(3)]: { date: recentDate(3), kcal: 2400, carbs: 280, pro: 160, fat: 70, weight: 80 },
        [recentDate(3, 1)]: { date: recentDate(3, 1), kcal: 2450, carbs: 290, pro: 160, fat: 70, weight: 80.1 },
        [recentDate(2)]: { date: recentDate(2), kcal: 2600, carbs: 320, pro: 170, fat: 75, weight: 80.3 },
        [recentDate(2, 1)]: { date: recentDate(2, 1), kcal: 2650, carbs: 330, pro: 170, fat: 75, weight: 80.4 },
        [recentDate(1)]: { date: recentDate(1), kcal: 2800, carbs: 350, pro: 180, fat: 80, weight: 80.6 }
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    // =========================================================================
    // SECTION 1: EMPTY STATE RENDERING & DEFENSIVE BOUNDARIES
    // =========================================================================
    describe('1. Empty State Rendering & Defensive Bounds', () => {
        it('1.1: WeeklyVolumeChart renders sentence case fallback with zero history', () => {
            render(
                <WeeklyVolumeChart
                    history={[]}
                    library={mockLibrary}
                    userWeight={80}
                />
            );

            expect(screen.getByText('Volume di allenamento settimanale')).toBeDefined();
            expect(screen.getByText('Nessun dato di allenamento nelle settimane selezionate.')).toBeDefined();
            expect(screen.getByText('Completa una sessione per visualizzare il volume di allenamento.')).toBeDefined();
        });

        it('1.2: WeeklyVolumeChart handles null or undefined props without throwing', () => {
            render(
                <WeeklyVolumeChart
                    history={undefined as any}
                    library={undefined as any}
                    userWeight={undefined as any}
                />
            );

            expect(screen.getByText('Volume di allenamento settimanale')).toBeDefined();
            expect(screen.getByText('Nessun dato di allenamento nelle settimane selezionate.')).toBeDefined();
        });

        it('1.3: VolumeCaloriesCorrelationChart renders sentence case fallback with empty history and nutrition', () => {
            render(
                <VolumeCaloriesCorrelationChart
                    history={[]}
                    nutrition={{}}
                    library={mockLibrary}
                    userWeight={80}
                />
            );

            expect(screen.getByText('Correlazione volume vs calorie')).toBeDefined();
            expect(screen.getByText('Dati insufficienti per calcolare la correlazione.')).toBeDefined();
            expect(screen.getByText('Registra allenamenti e pasti per visualizzare la relazione tra apporto energetico e carichi.')).toBeDefined();
        });

        it('1.4: VolumeCaloriesCorrelationChart handles null or undefined props defensively', () => {
            render(
                <VolumeCaloriesCorrelationChart
                    history={null as any}
                    nutrition={null as any}
                    library={null as any}
                    userWeight={null as any}
                />
            );

            expect(screen.getByText('Correlazione volume vs calorie')).toBeDefined();
            expect(screen.getByText('Dati insufficienti per calcolare la correlazione.')).toBeDefined();
        });

        it('1.5: Handles history with 0-volume sessions (zero reps/kg) gracefully', () => {
            const zeroHistory: WorkoutSession[] = [
                {
                    id: 'zero_1',
                    date: '2026-08-18',
                    routineName: 'Test',
                    exercises: [
                        {
                            exId: 'ex_bench',
                            sessionNote: '',
                            sets: [{ id: 's0', kg: '0', reps: '0', done: true }]
                        }
                    ]
                }
            ];

            render(
                <WeeklyVolumeChart
                    history={zeroHistory}
                    library={mockLibrary}
                    userWeight={80}
                />
            );

            // Should show empty fallback because total volume is 0
            expect(screen.getByText('Nessun dato di allenamento nelle settimane selezionate.')).toBeDefined();
        });
    });

    // =========================================================================
    // SECTION 2: PARTIAL STATE RENDERING & ASYMMETRIC LOGGING
    // =========================================================================
    describe('2. Partial State Rendering & Data Asymmetry', () => {
        it('2.1: Workouts present but NO nutrition logs: Volume chart active, Correlation shows insight', async () => {
            const history = generateRealisticHistory();

            const { container: volContainer } = render(
                <WeeklyVolumeChart
                    history={history}
                    library={mockLibrary}
                    userWeight={80}
                />
            );

            await waitFor(() => {
                expect(volContainer.querySelector('canvas')).not.toBeNull();
            });
            expect(await screen.findByText(/Attuale:/i)).toBeDefined();
            expect(await screen.findByText(/Media:/i)).toBeDefined();

            cleanup();

            render(
                <VolumeCaloriesCorrelationChart
                    history={history}
                    nutrition={{}}
                    library={mockLibrary}
                    userWeight={80}
                />
            );

            expect(screen.getByText('Dati insufficienti per calcolare la correlazione.')).toBeDefined();
        });

        it('2.2: Nutrition present but NO workouts: Volume chart shows empty state', () => {
            const nutrition = generateRealisticNutrition();

            render(
                <WeeklyVolumeChart
                    history={[]}
                    library={mockLibrary}
                    userWeight={80}
                />
            );

            expect(screen.getByText('Nessun dato di allenamento nelle settimane selezionate.')).toBeDefined();

            cleanup();

            render(
                <VolumeCaloriesCorrelationChart
                    history={[]}
                    nutrition={nutrition}
                    library={mockLibrary}
                    userWeight={80}
                />
            );

            expect(screen.getByText('Dati insufficienti per calcolare la correlazione.')).toBeDefined();
        });

        it('2.3: Sparse / staggered weeks: Volume and nutrition synchronised by week interval', () => {
            // Workouts in week 1 and 3, Nutrition in week 2 and 3
            const staggeredHistory: WorkoutSession[] = [
                {
                    id: 'w_1',
                    date: '2026-08-04',
                    routineName: 'Routine',
                    exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's1', kg: '100', reps: '10', done: true }] }]
                },
                {
                    id: 'w_3',
                    date: '2026-08-18',
                    routineName: 'Routine',
                    exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's3', kg: '110', reps: '10', done: true }] }]
                }
            ];

            const staggeredNutrition: Record<string, NutritionDay> = {
                '2026-08-11': { date: '2026-08-11', kcal: 2500, carbs: 300, pro: 160, fat: 70 },
                '2026-08-18': { date: '2026-08-18', kcal: 2700, carbs: 330, pro: 170, fat: 75 }
            };

            const result = computeVolumeCaloriesCorrelation(staggeredHistory, staggeredNutrition, mockLibrary, 80, 8, '2026-08-22');
            expect(result.points.length).toBe(8);

            // Week corresponding to 2026-08-18 has BOTH volume and calories
            const weekWithBoth = result.points.find(p => p.weekStart <= '2026-08-18' && p.weekEnd >= '2026-08-18');
            expect(weekWithBoth).toBeDefined();
            expect(weekWithBoth!.volumeKg).toBeGreaterThan(0);
            expect(weekWithBoth!.avgDailyKcal).toBeGreaterThan(0);
        });
    });

    // =========================================================================
    // SECTION 3: RAPID PERIOD SWITCHING & OSCILLATION STRESS
    // =========================================================================
    describe('3. Rapid Period Switching & State Oscillation', () => {
        it('3.1: Rapidly toggles periods in WeeklyVolumeChart without error', async () => {
            const history = generateRealisticHistory();

            const { container } = render(
                <WeeklyVolumeChart
                    history={history}
                    library={mockLibrary}
                    userWeight={80}
                    defaultWeeks={8}
                />
            );

            const btn4 = screen.getByText('4 sett');
            const btn8 = screen.getByText('8 sett');
            const btn12 = screen.getByText('12 sett');
            const btn24 = screen.getByText('24 sett');

            // Rapid switching loop: 30 rapid clicks
            for (let i = 0; i < 30; i++) {
                const target = i % 4 === 0 ? btn4 : (i % 4 === 1 ? btn8 : (i % 4 === 2 ? btn12 : btn24));
                fireEvent.click(target);
            }

            // End on 24 sett
            fireEvent.click(btn24);
            expect(btn24.getAttribute('aria-pressed')).toBe('true');
            expect(btn4.getAttribute('aria-pressed')).toBe('false');
            await waitFor(() => {
                expect(container.querySelector('canvas')).not.toBeNull();
            });
            await waitFor(() => {
                const chart = ChartJS.getChart(container.querySelector('canvas')!);
                expect(chart?.data.labels).toHaveLength(24);
            });
        });

        it('3.2: Rapidly toggles periods in VolumeCaloriesCorrelationChart without error', async () => {
            const history = generateRealisticHistory();
            const nutrition = generateRealisticNutrition();

            const { container } = render(
                <VolumeCaloriesCorrelationChart
                    history={history}
                    nutrition={nutrition}
                    library={mockLibrary}
                    userWeight={80}
                    defaultWeeks={8}
                />
            );

            const btn4 = screen.getByText('4 sett');
            const btn8 = screen.getByText('8 sett');
            const btn12 = screen.getByText('12 sett');
            const btn24 = screen.getByText('24 sett');

            for (let i = 0; i < 30; i++) {
                const target = i % 4 === 0 ? btn4 : (i % 4 === 1 ? btn8 : (i % 4 === 2 ? btn12 : btn24));
                fireEvent.click(target);
            }

            fireEvent.click(btn12);
            expect(btn12.getAttribute('aria-pressed')).toBe('true');
            expect(btn24.getAttribute('aria-pressed')).toBe('false');
            await waitFor(() => {
                expect(container.querySelector('canvas')).not.toBeNull();
            });
            await waitFor(() => {
                const chart = ChartJS.getChart(container.querySelector('canvas')!);
                expect(chart?.data.labels).toHaveLength(12);
            });
        });

        it('3.3: Verifies label formatting changes dynamically with period (d MMM vs dd/MM)', () => {
            const weeks8 = generateWeekIntervals(8, '2026-08-22');
            expect(weeks8[0].label).toMatch(/[0-9]+ [a-z]+/); // e.g.  29 giu or 6 lug

            const weeks24 = generateWeekIntervals(24, '2026-08-22');
            expect(weeks24[0].label).toMatch(/[0-9]{2}\/[0-9]{2}/); // e.g. 09/03
        });
    });

    // =========================================================================
    // SECTION 4: CANVAS, HIGH-DPI, RESIZE & MEMORY LEAK RESILIENCE
    // =========================================================================
    describe('4. Canvas, High-DPI, Resize & Memory Leak Resilience', () => {
        it('4.1: Chart mounts with mocked DPR 2x and 3x (no physical Retina test)', async () => {
            // Simulate Retina Display
            const originalDPR = window.devicePixelRatio;
            Object.defineProperty(window, 'devicePixelRatio', {
                writable: true,
                configurable: true,
                value: 2.0
            });

            const history = generateRealisticHistory();
            const { container: c1 } = render(
                <WeeklyVolumeChart
                    history={history}
                    library={mockLibrary}
                    userWeight={80}
                />
            );
            await waitFor(() => {
                expect(c1.querySelector('canvas')).not.toBeNull();
            });
            cleanup();

            // Simulate Super Retina Display (DPR 3x)
            Object.defineProperty(window, 'devicePixelRatio', {
                writable: true,
                configurable: true,
                value: 3.0
            });

            const { container: c2 } = render(
                <VolumeCaloriesCorrelationChart
                    history={history}
                    nutrition={generateRealisticNutrition()}
                    library={mockLibrary}
                    userWeight={80}
                />
            );
            await waitFor(() => {
                expect(c2.querySelector('canvas')).not.toBeNull();
            });

            // Restore
            Object.defineProperty(window, 'devicePixelRatio', {
                writable: true,
                configurable: true,
                value: originalDPR
            });
        });

        it('4.2: 50-cycle mount/unmount smoke (not heap or listener leak proof)', () => {
            const history = generateRealisticHistory();
            const nutrition = generateRealisticNutrition();

            // Perform 50 consecutive mount and cleanup cycles
            for (let i = 0; i < 50; i++) {
                const { unmount: u1 } = render(
                    <WeeklyVolumeChart
                        history={history}
                        library={mockLibrary}
                        userWeight={80}
                    />
                );
                u1();

                const { unmount: u2 } = render(
                    <VolumeCaloriesCorrelationChart
                        history={history}
                        nutrition={nutrition}
                        library={mockLibrary}
                        userWeight={80}
                    />
                );
                u2();
            }

            // Every chart was unmounted; no rendered chart SVG may leak across cycles.
            expect(document.querySelectorAll('svg')).toHaveLength(0);
        });

        it('4.3: Charts survive resize events in jsdom (no layout measurement)', async () => {
            const history = generateRealisticHistory();
            const nutrition = generateRealisticNutrition();

            const { container } = render(
                <div>
                    <WeeklyVolumeChart history={history} library={mockLibrary} userWeight={80} />
                    <VolumeCaloriesCorrelationChart history={history} nutrition={nutrition} library={mockLibrary} userWeight={80} />
                </div>
            );

            const breakpoints = [320, 375, 414, 768, 1024, 1440];
            breakpoints.forEach(width => {
                window.innerWidth = width;
                window.dispatchEvent(new Event('resize'));
            });

            await waitFor(() => {
                expect(container.querySelectorAll('canvas').length).toBe(2);
            });
            const canvases = container.querySelectorAll('canvas');
            expect(canvases.length).toBe(2);
        });
    });

    // =========================================================================
    // SECTION 5: ITALIAN SENTENCE CASE AUDIT ACROSS ALL USER-FACING LABELS
    // =========================================================================
    describe('5. Italian Sentence Case Strict Compliance Audit', () => {
        it('5.1: Verifies all headers, labels and button text follow strict Italian sentence case', async () => {
            const history = generateRealisticHistory();
            const nutrition = generateRealisticNutrition();

            render(
                <div>
                    <WeeklyVolumeChart history={history} library={mockLibrary} userWeight={80} />
                    <VolumeCaloriesCorrelationChart history={history} nutrition={nutrition} library={mockLibrary} userWeight={80} />
                </div>
            );

            // Card 1 Header
            expect(screen.getByText('Volume di allenamento settimanale')).toBeDefined();
            // Card 2 Header
            expect(screen.getByText('Correlazione volume vs calorie')).toBeDefined();

            // Sub-metrics
            expect(await screen.findByText(/Attuale:/i)).toBeDefined();
            expect(await screen.findByText(/Media:/i)).toBeDefined();

            // Period buttons (all lowercase except initial number)
            const buttons = screen.getAllByRole('button');
            buttons.forEach(btn => {
                const text = btn.textContent || '';
                expect(text).toMatch(/^[0-9]+ sett$/);
            });
        });

        it('5.2: Production insight text distinguishes strong positive and negative correlations', () => {
            const weeks = generateWeekIntervals(4, '2026-08-22');
            const dates = weeks.map(week => week.weekStart);
            const history: WorkoutSession[] = dates.map((date, i) => ({
                id: `session-${i}`, date,
                exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: `set-${i}`, kg: String(10 + i * 10), reps: '10' }] }]
            }));
            const nutritionFor = (values: number[]): Record<string, NutritionDay> =>
                Object.fromEntries(dates.map((date, i) => [date, {
                    date, kcal: values[i], carbs: 0, pro: 0, fat: 0
                }]));
            const positive = computeVolumeCaloriesCorrelation(history, nutritionFor([1800, 2100, 2400, 2700]), mockLibrary, 80, 4, '2026-08-22');
            const negative = computeVolumeCaloriesCorrelation(history, nutritionFor([2700, 2400, 2100, 1800]), mockLibrary, 80, 4, '2026-08-22');
            expect(positive.stats.correlationInsight).toMatch(/^Associazione positiva forte osservata/);
            expect(negative.stats.correlationInsight).toMatch(/^Associazione inversa forte osservata/);
            expect(positive.stats.correlationInsight).toContain('Non indica un rapporto di causa-effetto.');
            expect(negative.stats.correlationInsight).toContain('Non indica un rapporto di causa-effetto.');
        });
    });

    // =========================================================================
    // SECTION 6: INTERACTION CALLBACKS & CHART HOOKS
    // =========================================================================
    describe('6. Interactive Callbacks & Callback Hooks', () => {
        it('6.1: Chart.js click option invokes onSelectWeek only for an existing bar', async () => {
            const onSelect = vi.fn();
            const history = generateRealisticHistory();

            render(
                <WeeklyVolumeChart
                    history={history}
                    library={mockLibrary}
                    userWeight={80}
                    onSelectWeek={onSelect}
                />
            );

            expect(screen.getByText('Volume di allenamento settimanale')).toBeDefined();
            const canvas = await screen.findByRole('img', { name: /Volume settimanale/i });
            await waitFor(() => expect(ChartJS.getChart(canvas as HTMLCanvasElement)).toBeDefined());
            const chart = ChartJS.getChart(canvas as HTMLCanvasElement)!;
            const chartClick = chart.options.onClick;
            expect(chartClick).toBeTypeOf('function');
            chartClick!.call(chart, {} as any, [{ index: 0 }] as any, chart as any);
            expect(onSelect).toHaveBeenCalledTimes(1);
            expect(onSelect).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
            chartClick!.call(chart, {} as any, [{ index: 999 }] as any, chart as any);
            chartClick!.call(chart, {} as any, [] as any, chart as any);
            expect(onSelect).toHaveBeenCalledTimes(1);
        });

        it('6.2: Pearson correlation math boundaries (exact 1.0, -1.0, 0.0, NaN guard)', () => {
            // Perfect positive
            expect(calculatePearsonCorrelation([10, 20, 30, 40], [100, 200, 300, 400])).toBe(1);
            // Perfect negative
            expect(calculatePearsonCorrelation([10, 20, 30, 40], [400, 300, 200, 100])).toBe(-1);
            // Constant (zero variance) -> 0
            expect(calculatePearsonCorrelation([10, 10, 10, 10], [100, 200, 300, 400])).toBe(0);
            // Fewer than 3 points -> null
            expect(calculatePearsonCorrelation([10, 20], [100, 200])).toBeNull();
        });
    });
});

