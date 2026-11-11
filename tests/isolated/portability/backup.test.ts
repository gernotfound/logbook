import { describe, expect, it } from 'vitest';
import { createBackup, decodeImport, prepareImport } from '../../../src/lib/backup';
import { UserDataSchema } from '../../../src/lib/schema';
import {
    CURRENT_BACKUP_SCHEMA,
    CURRENT_DATA_SCHEMA,
    CURRENT_SYNC_PROTOCOL,
    FutureVersionError,
    LegacyVersionError,
} from '../../../src/lib/schemaEvolution';
import type { UserData } from '../../../src/types';
const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;

describe('versioned backup and non-mutating restore', () => {
    it('round-trips the current representative business fields and all independent version dimensions', () => {
        const data = parse({ profile: { height: 180 }, customFoods: [{ id: 0, name: 'A' }], activeCycleId: 'c',
            activePains: ['knee'], nutritionPlanningOrigin: 'user-edited', pendingConflicts: { nutritionPlanning: { onDaysCount: 0 } },
            catalogOverrides: { foods: { '0': { name: 'Override' } }, hiddenFoodIds: ['x'] }, extension: { flag: true },
            history: Array.from({ length: 24 }, (_, index) => ({ id: 'h' + index, date: (2024 + Math.floor(index / 12)) + '-' + String(index % 12 + 1).padStart(2, '0') + '-01' })) });
        const backup = JSON.parse(JSON.stringify(createBackup(data, 'user:A', { scope: 'cloud-and-device', months: [] }, { device: { workout: 'draft' } })));
        const restored = prepareImport(parse({}), decodeImport(backup, 'user:A').data, 'restore').data;
        expect(backup).toMatchObject({
            format: 'logbook-backup',
            version: CURRENT_BACKUP_SCHEMA,
            dataSchemaVersion: CURRENT_DATA_SCHEMA,
            syncProtocolVersion: CURRENT_SYNC_PROTOCOL,
            type: 'backup',
        });
        expect(backup.userData).toEqual(JSON.parse(JSON.stringify(data)));
        expect(restored).toEqual(parse(data));
        expect(backup.recovery.device.workout).toBe('draft');
        expect(decodeImport(backup, 'user:A').hasDeviceRecovery).toBe(true);
        expect(decodeImport(createBackup(parse({}), 'user:A'), 'user:A').hasDeviceRecovery).toBe(false);
        expect(restored.history).toHaveLength(24);
    });

    it('rejects pre-M1 backup formats instead of inventing migrations', () => {
        const legacyV1 = { format: 'logbook-backup', version: 1, type: 'backup', userData: {} };
        const legacyV2 = { format: 'logbook-backup', version: 2, type: 'backup', userData: {} };
        expect(() => decodeImport(legacyV1, 'guest')).toThrow(LegacyVersionError);
        expect(() => decodeImport(legacyV2, 'guest')).toThrow(LegacyVersionError);
    });

    it('rejects pre-launch sync protocols in an otherwise current backup container', () => {
        const base = createBackup(parse({}), 'guest') as any;
        for (const syncProtocolVersion of [1, 2]) {
            expect(() => decodeImport({ ...base, syncProtocolVersion }, 'guest')).toThrow(LegacyVersionError);
        }
    });

    it('rejects unknown future backup/data/sync dimensions', () => {
        const base = createBackup(parse({}), 'guest') as any;
        expect(() => decodeImport({ ...base, version: CURRENT_BACKUP_SCHEMA + 1 }, 'guest')).toThrow(FutureVersionError);
        expect(() => decodeImport({
            ...base,
            version: CURRENT_BACKUP_SCHEMA + 1,
            format: 'logbook-backup-vNext',
        }, 'guest')).toThrow(FutureVersionError);
        expect(() => decodeImport({ ...base, dataSchemaVersion: CURRENT_DATA_SCHEMA + 1 }, 'guest')).toThrow(FutureVersionError);
        expect(() => decodeImport({ ...base, syncProtocolVersion: CURRENT_SYNC_PROTOCOL + 1 }, 'guest')).toThrow(FutureVersionError);
    });

    it('rejects cross-account imports even when currently guest', () => {
        const payload = createBackup(parse({}), 'user:A');
        for (const owner of ['user:B', 'guest']) expect(() => decodeImport(payload, owner)).toThrow('altro utente');
    });

    it.each([{ history: {} }, { routines: [null] }, { nutrition: { '2026-02-30': {} } }, { library: [{ id: 'a' }, { id: 'a' }] }, { customFoods: [{ name: 'lost' }] }])('rejects malformed current-format identities/containers without mutation: %j', data => {
        const payload = createBackup(parse({}), 'guest') as any;
        payload.userData = data;
        expect(() => decodeImport(payload, 'guest')).toThrow();
    });

    it('accepts a current-version share while selecting only shareable collections', () => {
        const base = createBackup(parse({}), null) as any;
        const payload = {
            ...base,
            type: 'share',
            userData: {
                library: [{ id: 'ex-1', name: 'A' }],
                routines: [{ id: 'r-1', name: 'R', exercises: [] }],
                trainingCycles: [],
                profile: { height: 999 },
            },
        };
        const decoded = decodeImport(payload, 'guest');
        expect(decoded.share).toBe(true);
        expect(decoded.data).toEqual({
            library: payload.userData.library,
            routines: payload.userData.routines,
            trainingCycles: [],
        });
    });

    it('merges meals immutably, recalculates totals and keeps notes, zero and local collisions', () => {
        const current = parse({ nutrition: { '2026-09-01': { notes: 'local', weight: 0, meals: [{ id: 'a', name: 'A', quantity: 50, baseQty: 100, kcal: 100 }] } } });
        const before = structuredClone(current);
        const incoming = { nutrition: { '2026-09-01': { notes: 'incoming', weight: 80, meals: [{ id: 'a', kcal: 999 }, { id: 'b', name: 'B', quantity: 2, baseQty: 1, kcal: 70 }] } } };
        const result = prepareImport(current, incoming, 'merge');
        expect(result.collisions).toBe(1);
        expect(result.data.nutrition?.['2026-09-01']).toMatchObject({ notes: 'local', weight: 0, kcal: 190 });
        expect(current).toEqual(before);
        expect(incoming.nutrition['2026-09-01'].meals).toHaveLength(2);
    });

    it.each(['merge', 'restore'] as const)('rejects finite-input meal overflow during %s without changing either archive', mode => {
        const current = parse({ profile: { height: '170' } });
        const incoming = { nutrition: { '2026-09-01': {
            date: '2026-09-01', kcal: 0, carbs: 0, pro: 0, fat: 0,
            meals: [
                { id: 'a', name: 'A', quantity: 1, baseQty: 1, kcal: Number.MAX_VALUE, carbs: 0, pro: 0, fat: 0 },
                { id: 'b', name: 'B', quantity: 1, baseQty: 1, kcal: Number.MAX_VALUE, carbs: 0, pro: 0, fat: 0 },
            ],
        } } };
        const beforeCurrent = structuredClone(current);
        const beforeIncoming = structuredClone(incoming);
        expect(() => prepareImport(current, incoming, mode)).toThrow('Totali nutrizionali non rappresentabili');
        expect(current).toEqual(beforeCurrent);
        expect(incoming).toEqual(beforeIncoming);
    });

    it('preserves representable imported totals without overflowing an intermediate product', () => {
        const current = parse({});
        const incoming = { nutrition: { '2026-09-01': {
            date: '2026-09-01', meals: [{ id: 'portion', name: 'Porzione', quantity: 2, baseQty: 2,
                kcal: Number.MAX_VALUE, carbs: Number.MAX_VALUE, pro: Number.MAX_VALUE, fat: Number.MAX_VALUE }],
        } } };
        const result = prepareImport(current, incoming, 'merge');
        expect(result.data.nutrition?.['2026-09-01']).toMatchObject({
            kcal: Number.MAX_VALUE, carbs: Number.MAX_VALUE, pro: Number.MAX_VALUE, fat: Number.MAX_VALUE,
        });
    });

    it('restore replaces only included current fields and never imports legal acceptance', () => {
        const current = parse({ profile: { height: 170 }, activeCycleId: 'retained' });
        const result = prepareImport(current, { profile: { height: 180 }, legalConsent: { acceptedAt: '2026-09-01', termsVersion: '999' } }, 'restore');
        expect(result.data.profile?.height).toBe('180');
        expect(result.data.activeCycleId).toBe('retained');
        expect(result.data.legalConsent).toEqual(current.legalConsent);
    });
});

describe('lossless current backup import boundary', () => {
    it.each([
        { extraBusiness: { value: 'preserve' } },
        { nutrition: { '2026-09-01': { date: '2026-09-01', kcal: 'damaged' } } },
        { nutrition: { '2026-09-01': { date: '2026-09-01', cardioSessions: [{ id: 'cardio', modality: 'invalid', durationMinutes: 20 }] } } },
        { activeWorkout: { id: 'active', exercises: [], readiness: { capturedAt: 1, energy: 99 } } },
    ])('rejects lossy input before preview without changing the source: %j', incoming => {
        const payload = { ...createBackup(parse({}), 'guest'), userData: incoming };
        const before = structuredClone(payload);
        expect(() => decodeImport(payload, 'guest')).toThrow('dati non conservabili senza perdita');
        expect(payload).toEqual(before);
    });

    it('checks the raw active workout before its parser can strip nested fields', () => {
        const payload = { ...createBackup(parse({}), 'guest'), userData: {
            activeWorkout: { id: 'active', exercises: [{
                id: 'instance', exId: 'exercise', sets: [{ id: 'set', kg: '50', reps: '8',
                    segments: [{ id: 'segment', kg: '40', reps: '6', extraBusiness: 'preserve' }],
                }],
            }] },
        } };
        const before = structuredClone(payload);
        expect(() => decodeImport(payload, 'guest')).toThrow('dati non conservabili senza perdita');
        expect(payload).toEqual(before);
    });

    it('rejects loss in a selected share collection while ignoring non-share business fields', () => {
        const payload = { ...createBackup(parse({}), null), type: 'share', userData: {
            routines: [{ id: 'routine', exercises: [{ exId: 'exercise',
                progressionContract: { role: 'primary', extraBusiness: 'preserve' },
            }] }],
            profile: { height: 'not selected' },
        } };
        expect(() => decodeImport(payload, 'guest')).toThrow('dati non conservabili senza perdita');
    });

    it('validates incoming values even when a local collision would hide the fallback', () => {
        const current = parse({ library: [{ id: 'same', name: 'local' }] });
        const payload = { ...createBackup(current, 'guest'), userData: {
            library: [{ id: 'same', name: { lost: 'incoming' } }],
        } };
        expect(() => decodeImport(payload, 'guest')).toThrow('dati non conservabili senza perdita');
    });

    it.each(['merge', 'restore'] as const)('checks the final %s result and preserves both inputs on rejection', mode => {
        const current = parse({ profile: { height: '170' } });
        const incoming = { extraBusiness: { value: 'preserve' } };
        const beforeCurrent = structuredClone(current);
        const beforeIncoming = structuredClone(incoming);
        expect(() => prepareImport(current, incoming, mode)).toThrow('dati non conservabili senza perdita');
        expect(current).toEqual(beforeCurrent);
        expect(incoming).toEqual(beforeIncoming);
    });

    it('allows reversible conversions, defaults, null workout and deliberate legal-consent exclusion', () => {
        const current = parse({ profile: { height: '170' } });
        const payload = { ...createBackup(parse({}), 'guest'), userData: {
            profile: { height: 180 },
            nutrition: { '2026-09-01': { date: '2026-09-01', kcal: '123.5', weight: '80' } },
            activeWorkout: null,
            legalConsent: { invalid: 'never imported' },
        } };
        const before = structuredClone(payload);
        const decoded = decodeImport(payload, 'guest');
        const restored = prepareImport(current, decoded.data, 'restore').data;
        expect(restored.profile?.height).toBe('180');
        expect(restored.nutrition?.['2026-09-01']).toMatchObject({ kcal: 123.5, weight: 80 });
        expect(restored.activeWorkout).toBeNull();
        expect(restored.legalConsent).toEqual(current.legalConsent);
        expect(payload).toEqual(before);
    });

    it('retains the current local-wins merge policy for valid incoming collisions', () => {
        const current = parse({ library: [{ id: 'same', name: 'local' }] });
        const payload = { ...createBackup(parse({}), 'guest'), userData: {
            library: [{ id: 'same', name: 'incoming' }, { id: 'new', name: 'new' }],
        } };
        const decoded = decodeImport(payload, 'guest');
        const result = prepareImport(current, decoded.data, 'merge');
        expect(result.data.library?.map(item => item.name)).toEqual(['local', 'new']);
        expect(result.collisions).toBe(1);
    });
});
