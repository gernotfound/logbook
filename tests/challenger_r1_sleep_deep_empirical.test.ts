import { describe, it, expect } from 'vitest';
import { Logic } from '../src/lib/logic';
import { NutritionDaySchema, UserDataSchema } from '../src/lib/schema';
import { mergeNutrition } from '../src/lib/merge';
import { Exporter } from '../src/lib/export';

describe('Empirical Challenger: Deep Adversarial Sleep Format Suite (R1)', () => {

    describe('1. Logic.formatSleepTime, parseSleepInput & isSleepTimeValid Extreme Inputs', () => {
        it('tests boundary values and extreme clock inputs', () => {
            expect(Logic.formatSleepTime('00:00')).toBe('00:00');
            expect(Logic.formatSleepTime('23:59')).toBe('23:59');
            expect(Logic.formatSleepTime(0)).toBe('00:00');
            expect(Logic.formatSleepTime(24)).toBe('23:59');

            expect(Logic.formatSleepTime('24:00')).toBe('');
            expect(Logic.parseSleepInput('24:00')).toBeNull();
            expect(Logic.isSleepTimeValid('24:00')).toBe(false);

            expect(Logic.formatSleepTime('24')).toBe('23:59');
            expect(Logic.formatSleepTime('24.0')).toBe('23:59');
            expect(Logic.parseSleepInput('24')).toBe('23:59');
            expect(Logic.isSleepTimeValid('24')).toBe(true);

            expect(Logic.formatSleepTime('0:0')).toBe('00:00');
            expect(Logic.formatSleepTime('7:5')).toBe('07:05');
            expect(Logic.formatSleepTime('0:00')).toBe('00:00');
            expect(Logic.formatSleepTime('00:0')).toBe('00:00');
        });

        it('tests negative numbers and negative time strings', () => {
            expect(Logic.formatSleepTime('-01:00')).toBe('');
            expect(Logic.formatSleepTime('-00:30')).toBe('');
            expect(Logic.formatSleepTime('-7.5')).toBe('');
            expect(Logic.formatSleepTime(-1)).toBe('');
            expect(Logic.formatSleepTime(-0.0001)).toBe('');
            expect(Logic.formatSleepTime(-24)).toBe('');

            expect(Logic.parseSleepInput('-01:00')).toBeNull();
            expect(Logic.parseSleepInput('-7.5')).toBeNull();
            expect(Logic.isSleepTimeValid('-01:00')).toBe(false);
            expect(Logic.isSleepTimeValid('-7.5')).toBe(false);
        });

        it('tests invalid clock minutes and overflow hours', () => {
            const invalidTimes = [
                '99:99', '12:60', '23:60', '24:59', '00:99', '25:00', '10:100', '100:00',
                '08:30:00', '12:00:00', '::', ':', ':30', '08:', '12:--'
            ];

            for (const val of invalidTimes) {
                expect(Logic.formatSleepTime(val)).toBe('');
                expect(Logic.parseSleepInput(val)).toBeNull();
                expect(Logic.isSleepTimeValid(val)).toBe(false);
            }
        });

        it('tests non-numeric and injection strings', () => {
            const nonNumeric = [
                'abc', 'null', 'undefined', '[object Object]', '<script>alert(1)</script>',
                '8 hours', '8h30m', '8:30am', '8:30 PM', 'eight hours', 'N/A', 'true', 'false'
            ];

            for (const val of nonNumeric) {
                expect(Logic.formatSleepTime(val)).toBe('');
                expect(Logic.parseSleepInput(val)).toBeNull();
                expect(Logic.isSleepTimeValid(val)).toBe(false);
            }
        });

        it('tests legacy decimals with various fractional values and rounding', () => {
            expect(Logic.formatSleepTime(7.5)).toBe('07:30');
            expect(Logic.formatSleepTime(0.25)).toBe('00:15');
            expect(Logic.formatSleepTime(8.0)).toBe('08:00');
            expect(Logic.formatSleepTime(0)).toBe('00:00');
            expect(Logic.formatSleepTime(23.99)).toBe('23:59');
            expect(Logic.formatSleepTime(0.01)).toBe('00:01');
            expect(Logic.formatSleepTime(0.001)).toBe('00:00');
            expect(Logic.formatSleepTime(7.333333)).toBe('07:20');
            expect(Logic.formatSleepTime(7.666667)).toBe('07:40');
            expect(Logic.formatSleepTime(7.1)).toBe('07:06');
            expect(Logic.formatSleepTime(7.05)).toBe('07:03');

            expect(Logic.formatSleepTime('7,5')).toBe('07:30');
            expect(Logic.formatSleepTime('7.5h')).toBe('07:30');
            expect(Logic.formatSleepTime('7,5H')).toBe('07:30');
            expect(Logic.formatSleepTime(' 8.25 h ')).toBe('08:15');
        });

        it('tests special IEEE-754 floats and non-primitive types safely', () => {
            expect(Logic.formatSleepTime(NaN)).toBe('');
            expect(Logic.formatSleepTime(Infinity)).toBe('');
            expect(Logic.formatSleepTime(-Infinity)).toBe('');
            expect(Logic.formatSleepTime(Number.MAX_SAFE_INTEGER)).toBe('');
            expect(Logic.formatSleepTime(null)).toBe('');
            expect(Logic.formatSleepTime(undefined)).toBe('');
            expect(Logic.formatSleepTime({} as any)).toBe('');
            expect(Logic.formatSleepTime([] as any)).toBe('');
            expect(Logic.formatSleepTime(true as any)).toBe('');
            expect(Logic.formatSleepTime(false as any)).toBe('');
        });
    });

    describe('2. NutritionDaySchema & safeOptionalSleepTime Stress Tests', () => {
        it('normalizes legacy numbers, decimal strings, and modern HH:MM format', () => {
            const raw = {
                date: '2026-08-20',
                kcal: 2000,
                carbs: 200,
                pro: 150,
                fat: 50,
                sleepHours: 8.5,
                sleepDeep: '1.75',
                sleepLight: '04:15',
                sleepRem: '1,25h',
                sleepAwake: 0.5
            };

            const parsed = NutritionDaySchema.parse(raw);
            expect(parsed.sleepHours).toBe('08:30');
            expect(parsed.sleepDeep).toBe('01:45');
            expect(parsed.sleepLight).toBe('04:15');
            expect(parsed.sleepRem).toBe('01:15');
            expect(parsed.sleepAwake).toBe('00:30');
        });

        it('converts malformed, empty, null, negative, or invalid sleep inputs to undefined', () => {
            const malformed = {
                date: '2026-08-20',
                kcal: 2000,
                carbs: 200,
                pro: 150,
                fat: 50,
                sleepHours: '',
                sleepDeep: '   ',
                sleepLight: null,
                sleepRem: undefined,
                sleepAwake: 'invalid_time'
            };

            const parsed = NutritionDaySchema.parse(malformed);
            expect(parsed.sleepHours).toBeUndefined();
            expect(parsed.sleepDeep).toBeUndefined();
            expect(parsed.sleepLight).toBeUndefined();
            expect(parsed.sleepRem).toBeUndefined();
            expect(parsed.sleepAwake).toBeUndefined();
        });

        it('handles non-primitive or out-of-range sleep fields without throwing', () => {
            const crazyInputs = {
                date: '2026-08-20',
                kcal: 2000,
                carbs: 200,
                pro: 150,
                fat: 50,
                sleepHours: { hours: 8, minutes: 0 },
                sleepDeep: [1, 30],
                sleepLight: -5,
                sleepRem: 100,
                sleepAwake: NaN
            };

            const parsed = NutritionDaySchema.parse(crazyInputs);
            expect(parsed.sleepHours).toBeUndefined();
            expect(parsed.sleepDeep).toBeUndefined();
            expect(parsed.sleepLight).toBeUndefined();
            expect(parsed.sleepRem).toBeUndefined();
            expect(parsed.sleepAwake).toBeUndefined();
        });
    });

    describe('3. mergeNutrition Deterministic Conflict Resolution & Sleep Preservation', () => {
        it('preserves non-overlapping dates from cloud and guest', () => {
            const cloud = {
                '2026-08-18': { date: '2026-08-18', kcal: 2000, carbs: 200, pro: 150, fat: 50, sleepHours: '08:00' }
            };
            const guest = {
                '2026-08-19': { date: '2026-08-19', kcal: 2100, carbs: 220, pro: 160, fat: 55, sleepHours: '07:30' }
            };

            const merged = mergeNutrition(cloud, guest);
            expect(Object.keys(merged)).toHaveLength(2);
            expect(merged['2026-08-18'].sleepHours).toBe('08:00');
            expect(merged['2026-08-19'].sleepHours).toBe('07:30');
        });

        it('merges collision date: guest overrides total sleep but preserves non-colliding cloud phases', () => {
            const cloud = {
                '2026-08-20': {
                    date: '2026-08-20',
                    kcal: 2000,
                    carbs: 200,
                    pro: 150,
                    fat: 50,
                    sleepHours: '08:00',
                    sleepDeep: '02:00',
                    sleepLight: '04:00',
                    sleepRem: '01:30',
                    sleepAwake: '00:30'
                }
            };
            const guest = {
                '2026-08-20': {
                    date: '2026-08-20',
                    kcal: 2200,
                    carbs: 250,
                    pro: 160,
                    fat: 60,
                    sleepHours: '07:15',
                    sleepLight: '04:30'
                }
            };

            const merged = mergeNutrition(cloud, guest);
            const day = merged['2026-08-20'];
            expect(day.sleepHours).toBe('07:15');
            expect(day.sleepLight).toBe('04:30');
            expect(day.sleepDeep).toBe('02:00');
            expect(day.sleepRem).toBe('01:30');
            expect(day.sleepAwake).toBe('00:30');
        });

        it('does not allow guest empty string to wipe out cloud sleep phases', () => {
            const cloud = {
                '2026-08-20': {
                    date: '2026-08-20',
                    kcal: 2000,
                    carbs: 200,
                    pro: 150,
                    fat: 50,
                    sleepHours: '08:00',
                    sleepDeep: '02:00'
                }
            };
            const guest = {
                '2026-08-20': {
                    date: '2026-08-20',
                    kcal: 2000,
                    carbs: 200,
                    pro: 150,
                    fat: 50,
                    sleepHours: '07:45',
                    sleepDeep: ''
                }
            };

            const merged = mergeNutrition(cloud, guest);
            expect(merged['2026-08-20'].sleepHours).toBe('07:45');
            expect(merged['2026-08-20'].sleepDeep).toBe('02:00');
        });

        it('merges guest legacy numbers and cloud strings, and normalizes through UserDataSchema', () => {
            const cloud = {
                '2026-08-20': {
                    date: '2026-08-20',
                    kcal: 2000,
                    carbs: 200,
                    pro: 150,
                    fat: 50,
                    sleepHours: '08:00'
                }
            };
            const guest = {
                '2026-08-20': {
                    date: '2026-08-20',
                    kcal: 2000,
                    carbs: 200,
                    pro: 150,
                    fat: 50,
                    sleepHours: 7.5,
                    sleepDeep: 1.5
                }
            };

            const rawMerged = mergeNutrition(cloud, guest);
            const userWithMerged = {
                profile: {},
                library: [],
                routines: [],
                history: [],
                nutrition: rawMerged
            };

            const sanitized = UserDataSchema.parse(userWithMerged);
            expect(sanitized.nutrition['2026-08-20'].sleepHours).toBe('07:30');
            expect(sanitized.nutrition['2026-08-20'].sleepDeep).toBe('01:30');
        });

        it('handles null, undefined, and empty objects safely', () => {
            expect(mergeNutrition(null, null)).toEqual({});
            expect(mergeNutrition(undefined, undefined)).toEqual({});
            expect(mergeNutrition({}, {})).toEqual({});
            expect(mergeNutrition(null, { '2026-08-20': { date: '2026-08-20', kcal: 0, carbs: 0, pro: 0, fat: 0, sleepHours: '08:00' } })).toHaveProperty('2026-08-20');
            expect(mergeNutrition({ '2026-08-20': { date: '2026-08-20', kcal: 0, carbs: 0, pro: 0, fat: 0, sleepHours: '08:00' } }, null)).toHaveProperty('2026-08-20');
        });
    });

    describe('4. CSV Export Sleep Formatting & Sentence Case Header Verification', () => {
        it('exports all 5 sleep columns with Italian sentence case headers', async () => {
            let capturedFilename = '';
            let capturedContent = '';

            const origDownload = Exporter.downloadFile;
            Exporter.downloadFile = (fn: string, content: string) => {
                capturedFilename = fn;
                capturedContent = content;
            };

            const sampleNutrition = {
                '2026-08-20': {
                    date: '2026-08-20',
                    weight: 77.5,
                    kcal: 2300,
                    carbs: 280,
                    pro: 160,
                    fat: 65,
                    sleepHours: '08:15',
                    sleepDeep: '01:45',
                    sleepLight: '04:30',
                    sleepRem: '01:15',
                    sleepAwake: '00:45'
                }
            };

            try {
                await Exporter.exportToCSV([], sampleNutrition, []);
                await vi.waitFor(() => {
                    expect(capturedFilename).toBe('misurazioni.csv');
                }, { timeout: 3000 });

                expect(capturedContent).toContain('Ore sonno,Sonno profondo,Sonno leggero,Sonno REM,Tempo sveglio');
                expect(capturedContent).toContain('"2026-08-20",77.5,2300,280,160,65,,,,,,,,,,"08:15","01:45","04:30","01:15","00:45",');
            } finally {
                Exporter.downloadFile = origDownload;
            }
        });
    });
});
