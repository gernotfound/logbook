import { describe, expect, it } from 'vitest';
import { applyDomainOperations } from '../../../src/lib/sync/domainOperations';
import { UserDataSchema } from '../../../src/lib/schema';
import type { UserData } from '../../../src/types';
import { prepareSleepPatch, sleepDraftFromDay, type SleepDraftValues } from '../../../src/lib/sleepForm';

const empty: SleepDraftValues = {
    sleepHours: '',
    sleepDeep: '',
    sleepLight: '',
    sleepRem: '',
    sleepAwake: '',
};

describe('sleep form preparation boundary', () => {
    it('presents the supported HH:MM day fields without changing the source', () => {
        const day = {
            date: '2026-09-24',
            sleepHours: '7:5',
            sleepDeep: '01:30',
            sleepLight: 'bad',
            sleepRem: '00:00',
        };
        const snapshot = { ...day };
        expect(sleepDraftFromDay(day)).toEqual({
            sleepHours: '07:05',
            sleepDeep: '01:30',
            sleepLight: '',
            sleepRem: '00:00',
            sleepAwake: '',
        });
        expect(day).toEqual(snapshot);
    });

    it('keeps explicitly cleared phases undefined in the Domain Operations patch', () => {
        const form = { ...empty, sleepHours: '08:00' };
        const result = prepareSleepPatch(form);
        expect(result).toEqual({
            ok: true,
            patch: {
                sleepHours: '08:00',
                sleepDeep: undefined,
                sleepLight: undefined,
                sleepRem: undefined,
                sleepAwake: undefined,
            },
        });
        if (result.ok) {
            expect(Object.keys(result.patch)).toEqual([
                'sleepHours', 'sleepDeep', 'sleepLight', 'sleepRem', 'sleepAwake',
            ]);
        }
    });

    it('normalizes all phases, including valid zero, without mutating the input', () => {
        const form = {
            sleepHours: '8:0',
            sleepDeep: '2:5',
            sleepLight: '04:00',
            sleepRem: '1:55',
            sleepAwake: '00:00',
        };
        const initial = { ...form };
        expect(prepareSleepPatch(form)).toEqual({
            ok: true,
            patch: {
                sleepHours: '08:00',
                sleepDeep: '02:05',
                sleepLight: '04:00',
                sleepRem: '01:55',
                sleepAwake: '00:00',
            },
        });
        expect(form).toEqual(initial);
    });

    it.each(['', ' ', '24:00', '08:60', '8h', '7.5', '08:00h'])(
        'rejects invalid or absent total duration: %s',
        sleepHours => {
            expect(prepareSleepPatch({ ...empty, sleepHours })).toEqual({
                ok: false,
                message: 'Le ore di sonno sono obbligatorie e devono essere in un formato valido (HH:MM).',
            });
        },
    );

    it.each([
        ['sleepDeep', 'Il formato del sonno profondo non è valido (HH:MM).'],
        ['sleepLight', 'Il formato del sonno leggero non è valido (HH:MM).'],
        ['sleepRem', 'Il formato del sonno REM non è valido (HH:MM).'],
        ['sleepAwake', 'Il formato del tempo sveglio non è valido (HH:MM).'],
    ] as const)('rejects an invalid %s phase before creating a patch', (field, message) => {
        expect(prepareSleepPatch({ ...empty, sleepHours: '08:00', [field]: '26:70' }))
            .toEqual({ ok: false, message });
    });

    it('keeps the validation order of optional phases for multiple invalid inputs', () => {
        expect(prepareSleepPatch({
            ...empty, sleepHours: '08:00', sleepDeep: 'invalid', sleepRem: 'invalid',
        })).toEqual({ ok: false, message: 'Il formato del sonno profondo non è valido (HH:MM).' });
    });    it('clears a previously stored phase through the real Domain Operation reducer', () => {
        const date = '2026-09-24';
        const before = UserDataSchema.parse({ nutrition: {
            [date]: { date, sleepHours: '06:00', sleepDeep: '02:00', sleepLight: '04:00' },
        } }) as unknown as UserData;
        const prepared = prepareSleepPatch({ ...empty, sleepHours: '07:30' });
        if (!prepared.ok) throw new Error(prepared.message);

        const after = applyDomainOperations(before, {
            type: 'nutrition-day.patch', date, patch: prepared.patch,
        });
        const day = after.nutrition?.[date];
        expect(day?.sleepHours).toBe('07:30');
        expect(day?.sleepDeep).toBeUndefined();
        expect(day?.sleepLight).toBeUndefined();
        expect(Object.hasOwn(day ?? {}, 'sleepDeep')).toBe(false);
        expect(Object.hasOwn(day ?? {}, 'sleepLight')).toBe(false);
        expect(before.nutrition?.[date].sleepDeep).toBe('02:00');
    });


});
