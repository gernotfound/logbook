import { describe, it, expect } from 'vitest';
import * as Logic from '../src/lib/logic';
import { NutritionDaySchema, UserDataSchema } from '../src/lib/schema';
import { Exporter } from '../src/lib/export';

describe('Milestone 1: Sleep Format in HH:MM & Backward Compatibility Tests', () => {
    describe('1. Logic sleep helpers', () => {
        it('formatSleepTime normalizes string inputs', () => {
            expect(Logic.formatSleepTime('08:30')).toBe('08:30');
            expect(Logic.formatSleepTime('8:30')).toBe('08:30');
            expect(Logic.formatSleepTime('00:00')).toBe('00:00');
            expect(Logic.formatSleepTime('23:59')).toBe('23:59');
        });
        it('formatSleepTime handles edge cases and invalid inputs gracefully', () => {
            expect(Logic.formatSleepTime('')).toBe('');
            expect(Logic.formatSleepTime('   ')).toBe('');
            expect(Logic.formatSleepTime(null as any)).toBe('');
            expect(Logic.formatSleepTime(undefined as any)).toBe('');
            expect(Logic.formatSleepTime('invalid')).toBe('');
            expect(Logic.formatSleepTime('25:00')).toBe('');
            expect(Logic.formatSleepTime('12:65')).toBe('');
        });
        it('parseSleepInput parses valid sleep strings and returns canonical HH:MM', () => {
            expect(Logic.parseSleepInput('08:30')).toBe('08:30');
            expect(Logic.parseSleepInput('8:30')).toBe('08:30');
            expect(Logic.parseSleepInput('')).toBeNull();
            expect(Logic.parseSleepInput('   ')).toBeNull();
            expect(Logic.parseSleepInput(null as any)).toBeNull();
            expect(Logic.parseSleepInput(undefined as any)).toBeNull();
            expect(Logic.parseSleepInput('bad_string')).toBeNull();
        });
        it('isSleepTimeValid validates whether a sleep string is valid', () => {
            expect(Logic.isSleepTimeValid('08:30')).toBe(true);
            expect(Logic.isSleepTimeValid('8:30')).toBe(true);
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
            const rawDay = { date: '2026-08-20', kcal: 2000, carbs: 250, pro: 150, fat: 60, sleepHours: '08:30', sleepDeep: '01:45', sleepLight: '04:30', sleepRem: '01:30', sleepAwake: '00:45' };
            const parsed = NutritionDaySchema.parse(rawDay);
            expect(parsed.sleepHours).toBe('08:30');
            expect(parsed.sleepDeep).toBe('01:45');
            expect(parsed.sleepLight).toBe('04:30');
            expect(parsed.sleepRem).toBe('01:30');
            expect(parsed.sleepAwake).toBe('00:45');
        });
        it('gracefully handles missing, empty, or invalid sleep fields', () => {
            const emptyDay = { date: '2026-08-17', kcal: 1800, carbs: 200, pro: 140, fat: 50, sleepHours: '', sleepDeep: undefined, sleepLight: null, sleepRem: 'invalid_data', sleepAwake: 999 as any };
            const parsed = NutritionDaySchema.parse(emptyDay);
            expect(parsed.sleepHours).toBeUndefined();
            expect(parsed.sleepDeep).toBeUndefined();
            expect(parsed.sleepLight).toBeUndefined();
            expect(parsed.sleepRem).toBeUndefined();
            expect(parsed.sleepAwake).toBeUndefined();
        });
    });
    describe('3. Exporter CSV Sleep formatting', () => {
        it('formats sleep times properly when generating nutrition CSV', async () => {
            let capturedFilename = '';
            let capturedContent = '';
            const origDownload = Exporter.downloadFile;
            Exporter.downloadFile = (fn: string, content: string) => { capturedFilename = fn; capturedContent = content; };
            const sampleNutrition = { '2026-08-20': { date: '2026-08-20', weight: 75.5, kcal: 2300, carbs: 280, pro: 160, fat: 65, sleepHours: '07:45', sleepDeep: '01:30', sleepLight: '04:30', sleepRem: '01:15', sleepAwake: '00:30', notes: 'Buona notte' } };
            try {
                await Exporter.exportToCSV([{ id: 'fake' }], sampleNutrition, []);
                await new Promise(resolve => setTimeout(resolve, 600));
                expect(capturedFilename).toBe('misurazioni.csv');
                expect(capturedContent).toContain('07:45');
                expect(capturedContent).toContain('01:30');
                expect(capturedContent).toContain('04:30');
                expect(capturedContent).toContain('01:15');
                expect(capturedContent).toContain('00:30');
            } finally { Exporter.downloadFile = origDownload; }
        });
    });
});