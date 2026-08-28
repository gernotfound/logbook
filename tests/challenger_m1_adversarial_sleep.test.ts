import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act, renderHook } from '@testing-library/react';

import { Logic, formatSleepTime, parseSleepInput, isSleepTimeValid } from '../src/lib/logic';
import { NutritionDaySchema, UserDataSchema } from '../src/lib/schema';
import { Exporter } from '../src/lib/export';
import DataSleep from '../src/components/Data/DataSleep';
import { useSleepMeasurements } from '../src/hooks/useSleepMeasurements';
import { useAppStore } from '../src/store/useAppStore';
import { useDialogStore } from '../src/store/useDialogStore';

describe('Empirical Challenger: Sleep Format HH:MM Adversarial Stress Test Suite', () => {


    describe('1. Logic.formatSleepTime — Exhaustive Boundary & Attack Scenarios', () => {
        it('handles boundary numbers [0, 24] and float precision', () => {
            // Lower boundaries
            expect(formatSleepTime(0)).toBe('00:00');
            expect(formatSleepTime(0.0001)).toBe('00:00');
            expect(formatSleepTime(0.01)).toBe('00:01'); // 0.01 * 60 = 0.6 -> rounds to 1 min
            expect(formatSleepTime(0.5)).toBe('00:30');
            expect(formatSleepTime(0.99)).toBe('00:59');

            // Decimal float fractions
            expect(formatSleepTime(1.25)).toBe('01:15');
            expect(formatSleepTime(7.5)).toBe('07:30');
            expect(formatSleepTime(7.75)).toBe('07:45');
            expect(formatSleepTime(8.33333)).toBe('08:20');
            expect(formatSleepTime(12.75)).toBe('12:45');

            // Upper boundaries
            expect(formatSleepTime(23)).toBe('23:00');
            expect(formatSleepTime(23.5)).toBe('23:30');
            expect(formatSleepTime(23.99)).toBe('23:59');
            expect(formatSleepTime(24)).toBe('23:59'); // clamped to max HH:MM
        });

        it('rejects out-of-bounds numbers and special float values', () => {
            expect(formatSleepTime(-0.001)).toBe('');
            expect(formatSleepTime(-1)).toBe('');
            expect(formatSleepTime(-24)).toBe('');
            expect(formatSleepTime(24.01)).toBe('');
            expect(formatSleepTime(25)).toBe('');
            expect(formatSleepTime(100)).toBe('');
            expect(formatSleepTime(NaN)).toBe('');
            expect(formatSleepTime(Infinity)).toBe('');
            expect(formatSleepTime(-Infinity)).toBe('');
        });

        it('handles valid time strings in various formats', () => {
            expect(formatSleepTime('00:00')).toBe('00:00');
            expect(formatSleepTime('07:30')).toBe('07:30');
            expect(formatSleepTime('7:30')).toBe('07:30');
            expect(formatSleepTime('7:5')).toBe('07:05');
            expect(formatSleepTime('0:0')).toBe('00:00');
            expect(formatSleepTime('23:59')).toBe('23:59');
            expect(formatSleepTime('  08:15  ')).toBe('08:15');
        });

        it('handles legacy numeric strings with decimals, commas, and "h" suffix', () => {
            expect(formatSleepTime('0')).toBe('00:00');
            expect(formatSleepTime('7')).toBe('07:00');
            expect(formatSleepTime('7.5')).toBe('07:30');
            expect(formatSleepTime('7,5')).toBe('07:30');
            expect(formatSleepTime('1.25')).toBe('01:15');
            expect(formatSleepTime('12.75')).toBe('12:45');
            expect(formatSleepTime('8h')).toBe('08:00');
            expect(formatSleepTime('7.5h')).toBe('07:30');
            expect(formatSleepTime('7,5H')).toBe('07:30');
            expect(formatSleepTime(' 8.25 h ')).toBe('08:15');
        });

        it('rejects malformed string attack vectors', () => {
            const malformed = [
                '25:00',
                '24:00',
                '08:60',
                '12:99',
                '-01:00',
                '-1',
                'abc',
                'undefined',
                'null',
                '[object Object]',
                '08:30:00', // extra seconds not supported in HH:MM timepicker format
                '8:30pm',
                '8am',
                '1e2',
                '--7.5',
                '7..5',
                '..',
                ':',
                '::',
                ':30',
                '08:',
                '   '
            ];

            for (const item of malformed) {
                expect(formatSleepTime(item), `Expected empty string for malformed input: "${item}"`).toBe('');
            }
        });

        it('rejects non-string/non-number types safely without throwing', () => {
            expect(formatSleepTime(null)).toBe('');
            expect(formatSleepTime(undefined)).toBe('');
            expect(formatSleepTime({} as any)).toBe('');
            expect(formatSleepTime([] as any)).toBe('');
            expect(formatSleepTime(true as any)).toBe('');
            expect(formatSleepTime(false as any)).toBe('');
            expect(formatSleepTime((() => {}) as any)).toBe('');
        });
    });

    describe('2. Logic.parseSleepInput and Logic.isSleepTimeValid', () => {
        it('parseSleepInput returns canonical HH:MM or null', () => {
            expect(parseSleepInput('08:30')).toBe('08:30');
            expect(parseSleepInput('8:30')).toBe('08:30');
            expect(parseSleepInput(7.5)).toBe('07:30');
            expect(parseSleepInput('7.5')).toBe('07:30');
            expect(parseSleepInput('00:00')).toBe('00:00');
            expect(parseSleepInput('23:59')).toBe('23:59');

            expect(parseSleepInput('')).toBeNull();
            expect(parseSleepInput(null)).toBeNull();
            expect(parseSleepInput(undefined)).toBeNull();
            expect(parseSleepInput('25:00')).toBeNull();
            expect(parseSleepInput('08:60')).toBeNull();
            expect(parseSleepInput('abc')).toBeNull();
            expect(parseSleepInput(-1)).toBeNull();
        });

        it('isSleepTimeValid returns boolean strictly', () => {
            expect(isSleepTimeValid('08:30')).toBe(true);
            expect(isSleepTimeValid('00:00')).toBe(true);
            expect(isSleepTimeValid('23:59')).toBe(true);
            expect(isSleepTimeValid('7.5')).toBe(true);
            expect(isSleepTimeValid('8h')).toBe(true);

            expect(isSleepTimeValid('')).toBe(false);
            expect(isSleepTimeValid('   ')).toBe(false);
            expect(isSleepTimeValid('25:00')).toBe(false);
            expect(isSleepTimeValid('08:60')).toBe(false);
            expect(isSleepTimeValid('random')).toBe(false);
            expect(isSleepTimeValid(null as any)).toBe(false);
            expect(isSleepTimeValid(undefined as any)).toBe(false);
        });
    });

    describe('3. Zod Gateway Sanitization (NutritionDaySchema & UserDataSchema)', () => {
        it('sanitizes mixed valid, legacy, and malformed sleep fields without dropping valid data', () => {
            const rawDay = {
                date: '2026-08-20',
                kcal: 2500,
                carbs: 300,
                pro: 160,
                fat: 70,
                sleepHours: '08:30',       // Valid HH:MM string
                sleepDeep: 1.5,            // Legacy number -> "01:30"
                sleepLight: '4.25',        // Legacy decimal string -> "04:15"
                sleepRem: 'invalid_rem',   // Malformed -> undefined
                sleepAwake: -10            // Negative number -> undefined
            };

            const result = NutritionDaySchema.safeParse(rawDay);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.sleepHours).toBe('08:30');
                expect(result.data.sleepDeep).toBe('01:30');
                expect(result.data.sleepLight).toBe('04:15');
                expect(result.data.sleepRem).toBeUndefined();
                expect(result.data.sleepAwake).toBeUndefined();
            }
        });

        it('handles boundary values in NutritionDaySchema', () => {
            const boundaryDay = {
                date: '2026-08-20',
                kcal: 2000,
                carbs: 200,
                pro: 150,
                fat: 50,
                sleepHours: '00:00',
                sleepDeep: '23:59',
                sleepLight: 0,
                sleepRem: 24,
                sleepAwake: '  00:01  '
            };

            const parsed = NutritionDaySchema.parse(boundaryDay);
            expect(parsed.sleepHours).toBe('00:00');
            expect(parsed.sleepDeep).toBe('23:59');
            expect(parsed.sleepLight).toBe('00:00');
            expect(parsed.sleepRem).toBe('23:59');
            expect(parsed.sleepAwake).toBe('00:01');
        });

        it('survives empty/nullish sleep properties in full UserDataSchema', () => {
            const userWithNulls = {
                profile: {},
                library: [],
                routines: [],
                history: [],
                nutrition: {
                    '2026-08-20': {
                        date: '2026-08-20',
                        kcal: 1900,
                        carbs: 200,
                        pro: 140,
                        fat: 60,
                        sleepHours: '',
                        sleepDeep: null,
                        sleepLight: undefined,
                        sleepRem: '25:00',
                        sleepAwake: NaN
                    }
                }
            };

            const parsedUser = UserDataSchema.parse(userWithNulls);
            const nutritionDay = parsedUser.nutrition['2026-08-20'];
            expect(nutritionDay.sleepHours).toBeUndefined();
            expect(nutritionDay.sleepDeep).toBeUndefined();
            expect(nutritionDay.sleepLight).toBeUndefined();
            expect(nutritionDay.sleepRem).toBeUndefined();
            expect(nutritionDay.sleepAwake).toBeUndefined();
        });
    });

    describe('4. CSV Export Adversarial Tests', () => {
        it('exports correctly formatted sleep columns with sentence case headers', async () => {
            let capturedFilename = '';
            let capturedContent = '';

            const origDownload = Exporter.downloadFile;
            Exporter.downloadFile = (fn: string, content: string) => {
                capturedFilename = fn;
                capturedContent = content;
            };

            const sampleNutrition = {
                '2026-08-19': {
                    date: '2026-08-19',
                    weight: 78.2,
                    kcal: 2400,
                    carbs: 290,
                    pro: 170,
                    fat: 70,
                    sleepHours: '07:30',
                    sleepDeep: '01:45',
                    sleepLight: '04:15',
                    sleepRem: '01:00',
                    sleepAwake: '00:30'
                },
                '2026-08-20': {
                    date: '2026-08-20',
                    weight: 78.0,
                    kcal: 2350,
                    carbs: 280,
                    pro: 165,
                    fat: 68,
                    sleepHours: 8, // legacy number
                    sleepDeep: 1.75, // legacy number
                    sleepLight: '3.5', // legacy string
                    sleepRem: null, // empty
                    sleepAwake: 'invalid' // invalid
                }
            };

            try {
                await Exporter.exportToCSV([], sampleNutrition, []);
                await new Promise(resolve => setTimeout(resolve, 600));

                expect(capturedFilename).toBe('misurazioni.csv');
                
                // Verify Sentence Case in CSV Header
                expect(capturedContent).toContain('Ore sonno,Sonno profondo,Sonno leggero,Sonno REM,Tempo sveglio');

                // Verify day 1 values
                expect(capturedContent).toContain('2026-08-19,78.2,2400,290,170,70,,,,,,,,,,07:30,01:45,04:15,01:00,00:30,');

                // Verify day 2 values with legacy conversion and sanitization
                expect(capturedContent).toContain('2026-08-20,78,2350,280,165,68,,,,,,,,,,08:00,01:45,03:30,,,');
            } finally {
                Exporter.downloadFile = origDownload;
            }
        });
    });

    describe('5. useSleepMeasurements Hook Adversarial Verification', () => {
        it('initializes from legacy number sleep data and formats to HH:MM in UI state', () => {
            const today = Logic.getLocalDateString();
            useAppStore.setState({
                userData: {
                    nutrition: {
                        [today]: {
                            date: today,
                            sleepHours: 7.5,
                            sleepDeep: 1.25,
                            sleepLight: 4.5,
                            sleepRem: 1.75,
                            sleepAwake: 0.5
                        }
                    }
                } as any
            });

            const { result } = renderHook(() => useSleepMeasurements());

            expect(result.current.sleepHours).toBe('07:30');
            expect(result.current.sleepDeep).toBe('01:15');
            expect(result.current.sleepLight).toBe('04:30');
            expect(result.current.sleepRem).toBe('01:45');
            expect(result.current.sleepAwake).toBe('00:30');
        });

        it('blocks invalid inputs with alert without corrupting state', async () => {
            const showAlertSpy = useDialogStore.getState().showAlert as any;
            showAlertSpy.mockClear();

            useAppStore.setState({
                userData: {
                    nutrition: {}
                } as any,
                saveUserData: vi.fn()
            });

            const { result } = renderHook(() => useSleepMeasurements());

            // 1. Empty sleepHours
            await act(async () => {
                await result.current.saveSleep();
            });
            expect(showAlertSpy).toHaveBeenCalledWith(expect.stringContaining('formato valido (HH:MM)'));

            // 2. Invalid sleepHours
            showAlertSpy.mockClear();
            act(() => {
                result.current.setSleepHours('25:00');
            });
            await act(async () => {
                await result.current.saveSleep();
            });
            expect(showAlertSpy).toHaveBeenCalledWith(expect.stringContaining('formato valido (HH:MM)'));

            // 3. Valid sleepHours but invalid sleepDeep
            showAlertSpy.mockClear();
            act(() => {
                result.current.setSleepHours('08:00');
                result.current.setSleepDeep('99:99');
            });
            await act(async () => {
                await result.current.saveSleep();
            });
            expect(showAlertSpy).toHaveBeenCalledWith(expect.stringContaining('sonno profondo non è valido'));

            // Store save function should not have been called
            expect(useAppStore.getState().saveUserData).not.toHaveBeenCalled();
        });

        it('successfully saves valid sleep data in canonical HH:MM format', async () => {
            const showAlertSpy = useDialogStore.getState().showAlert as any;
            showAlertSpy.mockClear();

            let savedState: any = null;
            useAppStore.setState({
                userData: {
                    nutrition: {}
                } as any,
                saveUserData: async (updater: any) => {
                    savedState = updater(useAppStore.getState().userData);
                    useAppStore.setState({ userData: savedState });
                }
            });


            const { result } = renderHook(() => useSleepMeasurements());

            act(() => {
                result.current.setSleepHours('07:45');
                result.current.setSleepDeep('01:30');
                result.current.setSleepLight('04:15');
                result.current.setSleepRem('01:15');
                result.current.setSleepAwake('00:45');
            });

            await act(async () => {
                await result.current.saveSleep();
            });

            const today = Logic.getLocalDateString();
            expect(savedState).toBeDefined();
            expect(savedState.nutrition[today].sleepHours).toBe('07:45');
            expect(savedState.nutrition[today].sleepDeep).toBe('01:30');
            expect(savedState.nutrition[today].sleepLight).toBe('04:15');
            expect(savedState.nutrition[today].sleepRem).toBe('01:15');
            expect(savedState.nutrition[today].sleepAwake).toBe('00:45');
        });
    });

    describe('6. DataSleep Component UI Rendering and Sentence Case Compliance', () => {
        it('renders all input fields with type="time" and compliant sentence case labels', () => {
            const mockHook = {
                editingDate: null,
                setEditingDate: vi.fn(),
                sleepHours: '08:00',
                setSleepHours: vi.fn(),
                sleepDeep: '01:30',
                setSleepDeep: vi.fn(),
                sleepLight: '04:30',
                setSleepLight: vi.fn(),
                sleepRem: '01:30',
                setSleepRem: vi.fn(),
                sleepAwake: '00:30',
                setSleepAwake: vi.fn(),
                saveSleep: vi.fn()
            };

            render(React.createElement(DataSleep, { sleepHook: mockHook }));

            // Check inputs and type="time"
            const sleepHoursInput = document.getElementById('sleep-hours') as HTMLInputElement;
            expect(sleepHoursInput).toBeDefined();
            expect(sleepHoursInput.type).toBe('time');
            expect(sleepHoursInput.value).toBe('08:00');

            const sleepDeepInput = document.getElementById('sleep-deep') as HTMLInputElement;
            expect(sleepDeepInput.type).toBe('time');
            expect(sleepDeepInput.value).toBe('01:30');

            // Check Italian sentence case labels
            expect(screen.getByText('Ore sonno (totali)')).toBeDefined();
            expect(screen.getByText('Dettagli fasi (opzionali)')).toBeDefined();
            expect(screen.getByText('Sonno profondo')).toBeDefined();
            expect(screen.getByText('Sonno leggero')).toBeDefined();
            expect(screen.getByText('Sonno REM')).toBeDefined();
            expect(screen.getByText('Tempo sveglio')).toBeDefined();
            expect(screen.getByText(/Salva sonno/i)).toBeDefined();
        });
    });
});

