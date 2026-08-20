import { describe, it, expect } from 'vitest';
import { Logic } from '../src/lib/logic';
import { NutritionDaySchema, UserDataSchema } from '../src/lib/schema';
import { Exporter } from '../src/lib/export';

describe('Milestone 1: Sleep Format in HH:MM & Backward Compatibility Tests', () => {

    describe('1. Logic sleep helpers', () => {
        it('formatSleepTime converts decimal hours into standard HH:MM', () => {
            expect(Logic.formatSleepTime(7.5)).toBe('07:30');
            expect(Logic.formatSleepTime(8)).toBe('08:00');
            expect(Logic.formatSleepTime(1.25)).toBe('01:15');
            expect(Logic.formatSleepTime(6.75)).toBe('06:45');
            expect(Logic.formatSleepTime(0.5)).toBe('00:30');
            expect(Logic.formatSleepTime(0)).toBe('00:00');
            expect(Logic.formatSleepTime(23.5)).toBe('23:30');
        });

        it('formatSleepTime normalizes string inputs', () => {
            expect(Logic.formatSleepTime('08:30')).toBe('08:30');
            expect(Logic.formatSleepTime('8:30')).toBe('08:30');
            expect(Logic.formatSleepTime('7:5')).toBe('07:05');
            expect(Logic.formatSleepTime('00:00')).toBe('00:00');
            expect(Logic.formatSleepTime('23:59')).toBe('23:59');
            expect(Logic.formatSleepTime('7.5')).toBe('07:30');
            expect(Logic.formatSleepTime('7,5')).toBe('07:30');
            expect(Logic.formatSleepTime('1.25')).toBe('01:15');
            expect(Logic.formatSleepTime('8h')).toBe('08:00');
            expect(Logic.formatSleepTime('7.5h')).toBe('07:30');
        });

        it('formatSleepTime handles edge cases and invalid inputs gracefully', () => {
            expect(Logic.formatSleepTime('')).toBe('');
            expect(Logic.formatSleepTime('   ')).toBe('');
            expect(Logic.formatSleepTime(null)).toBe('');
            expect(Logic.formatSleepTime(undefined)).toBe('');
            expect(Logic.formatSleepTime('invalid')).toBe('');
            expect(Logic.formatSleepTime('25:00')).toBe('');
            expect(Logic.formatSleepTime('12:60')).toBe('');
            expect(Logic.formatSleepTime(-1)).toBe('');
            expect(Logic.formatSleepTime(25)).toBe('');
            expect(Logic.formatSleepTime(NaN)).toBe('');
            expect(Logic.formatSleepTime(Infinity)).toBe('');
        });

        it('parseSleepInput parses valid sleep strings and returns canonical HH:MM', () => {
            expect(Logic.parseSleepInput('08:30')).toBe('08:30');
            expect(Logic.parseSleepInput('8:30')).toBe('08:30');
            expect(Logic.parseSleepInput('7.5')).toBe('07:30');
            expect(Logic.parseSleepInput('7,5')).toBe('07:30');
            expect(Logic.parseSleepInput('1.25')).toBe('01:15');
            expect(Logic.parseSleepInput('')).toBeNull();
            expect(Logic.parseSleepInput('   ')).toBeNull();
            expect(Logic.parseSleepInput(null)).toBeNull();
            expect(Logic.parseSleepInput(undefined)).toBeNull();
            expect(Logic.parseSleepInput('bad_string')).toBeNull();
        });

        it('isSleepTimeValid validates whether a sleep string is valid', () => {
            expect(Logic.isSleepTimeValid('08:30')).toBe(true);
            expect(Logic.isSleepTimeValid('8:30')).toBe(true);
            expect(Logic.isSleepTimeValid('7.5')).toBe(true);
            expect(Logic.isSleepTimeValid('00:00')).toBe(true);
            expect(Logic.isSleepTimeValid('23:59')).toBe(true);

            expect(Logic.isSleepTimeValid('')).toBe(false);
            expect(Logic.isSleepTimeValid('  ')).toBe(false);
            expect(Logic.isSleepTimeValid('25:00')).toBe(false);
            expect(Logic.isSleepTimeValid('08:60')).toBe(false);
            expect(Logic.isSleepTimeValid('random')).toBe(false);
            expect(Logic.isSleepTimeValid(null as any)).toBe(false);
            expect(Logic.isSleepTimeValid(undefined as any)).toBe(false);
        });
    });

    describe('2. NutritionDaySchema & safeOptionalSleepTime Zod Gateway', () => {
        it('parses modern HH:MM format strings and preserves them', () => {
            const rawDay = {
                date: '2026-08-20',
                kcal: 2000,
                carbs: 250,
                pro: 150,
                fat: 60,
                sleepHours: '08:30',
                sleepDeep: '01:45',
                sleepLight: '04:30',
                sleepRem: '01:30',
                sleepAwake: '00:45'
            };

            const parsed = NutritionDaySchema.parse(rawDay);
            expect(parsed.sleepHours).toBe('08:30');
            expect(parsed.sleepDeep).toBe('01:45');
            expect(parsed.sleepLight).toBe('04:30');
            expect(parsed.sleepRem).toBe('01:30');
            expect(parsed.sleepAwake).toBe('00:45');
        });

        it('transforms legacy decimal numbers into HH:MM strings', () => {
            const legacyDay = {
                date: '2026-08-19',
                kcal: 2200,
                carbs: 280,
                pro: 160,
                fat: 65,
                sleepHours: 7.5,
                sleepDeep: 1.5,
                sleepLight: 4.25,
                sleepRem: 1.25,
                sleepAwake: 0.5
            };

            const parsed = NutritionDaySchema.parse(legacyDay);
            expect(parsed.sleepHours).toBe('07:30');
            expect(parsed.sleepDeep).toBe('01:30');
            expect(parsed.sleepLight).toBe('04:15');
            expect(parsed.sleepRem).toBe('01:15');
            expect(parsed.sleepAwake).toBe('00:30');
        });

        it('transforms legacy decimal strings into standard HH:MM strings', () => {
            const legacyStringDay = {
                date: '2026-08-18',
                kcal: 2100,
                carbs: 260,
                pro: 155,
                fat: 62,
                sleepHours: '7.5',
                sleepDeep: '1.75',
                sleepLight: '4.0',
                sleepRem: '1.25',
                sleepAwake: '0.5'
            };

            const parsed = NutritionDaySchema.parse(legacyStringDay);
            expect(parsed.sleepHours).toBe('07:30');
            expect(parsed.sleepDeep).toBe('01:45');
            expect(parsed.sleepLight).toBe('04:00');
            expect(parsed.sleepRem).toBe('01:15');
            expect(parsed.sleepAwake).toBe('00:30');
        });

        it('gracefully handles missing, empty, or invalid sleep fields', () => {
            const emptyDay = {
                date: '2026-08-17',
                kcal: 1800,
                carbs: 200,
                pro: 140,
                fat: 50,
                sleepHours: '',
                sleepDeep: undefined,
                sleepLight: null,
                sleepRem: 'invalid_data',
                sleepAwake: 999
            };

            const parsed = NutritionDaySchema.parse(emptyDay);
            expect(parsed.sleepHours).toBeUndefined();
            expect(parsed.sleepDeep).toBeUndefined();
            expect(parsed.sleepLight).toBeUndefined();
            expect(parsed.sleepRem).toBeUndefined();
            expect(parsed.sleepAwake).toBeUndefined();
        });

        it('integrates seamlessly into full UserDataSchema sanitization', () => {
            const userData = {
                profile: {},
                library: [],
                routines: [],
                history: [],
                nutrition: {
                    '2026-08-20': {
                        date: '2026-08-20',
                        kcal: 2400,
                        carbs: 300,
                        pro: 160,
                        fat: 70,
                        sleepHours: '08:15',
                        sleepDeep: 1.5 // legacy mixed with modern
                    }
                }
            };

            const parsedUser = UserDataSchema.parse(userData);
            expect(parsedUser.nutrition['2026-08-20'].sleepHours).toBe('08:15');
            expect(parsedUser.nutrition['2026-08-20'].sleepDeep).toBe('01:30');
        });
    });

    describe('3. Exporter CSV Sleep formatting', () => {
        it('formats sleep times properly when generating nutrition CSV', async () => {
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
                    weight: 75.5,
                    kcal: 2300,
                    carbs: 280,
                    pro: 160,
                    fat: 65,
                    sleepHours: '07:45',
                    sleepDeep: 1.5, // legacy number
                    sleepLight: '04:30',
                    sleepRem: '01:15',
                    sleepAwake: '00:30',
                    notes: 'Buona notte'
                }
            };

            try {
                await Exporter.exportToCSV([], sampleNutrition, []);
                // Wait for the setTimeout in exportToCSV
                await new Promise(resolve => setTimeout(resolve, 600));

                expect(capturedFilename).toBe('misurazioni.csv');
                expect(capturedContent).toContain('07:45');
                expect(capturedContent).toContain('01:30');
                expect(capturedContent).toContain('04:30');
                expect(capturedContent).toContain('01:15');
                expect(capturedContent).toContain('00:30');
            } finally {
                Exporter.downloadFile = origDownload;
            }
        });
    });
});
