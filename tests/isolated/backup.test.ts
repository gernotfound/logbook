import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/lib/telemetryHub', () => ({ telemetryHub: { trackEvent: vi.fn(), trackError: vi.fn() } }));
import { createBackup, decodeImport, prepareImport } from '../../src/lib/backup';
import { UserDataSchema } from '../../src/lib/schema';
import {
    CURRENT_BACKUP_SCHEMA,
    CURRENT_DATA_SCHEMA,
    CURRENT_SYNC_PROTOCOL,
    FutureVersionError,
    LegacyVersionError,
} from '../../src/lib/schemaEvolution';
import type { UserData } from '../../src/types';
const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;

describe('versioned backup and non-mutating restore', () => {
    it('round-trips every field and writes all independent version dimensions', () => {
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
        expect(restored.history).toHaveLength(24);
    });

    it('rejects pre-M1 backup formats instead of inventing migrations', () => {
        const legacyV1 = { format: 'logbook-backup', version: 1, type: 'backup', userData: {} };
        const legacyV2 = { format: 'logbook-backup', version: 2, type: 'backup', userData: {} };
        expect(() => decodeImport(legacyV1, 'guest')).toThrow(LegacyVersionError);
        expect(() => decodeImport(legacyV2, 'guest')).toThrow(LegacyVersionError);
    });

    it('rejects unknown future backup/data/sync dimensions', () => {
        const base = createBackup(parse({}), 'guest') as any;
        expect(() => decodeImport({ ...base, version: CURRENT_BACKUP_SCHEMA + 1 }, 'guest')).toThrow(FutureVersionError);
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

    it('restore replaces only included current fields and never imports legal acceptance', () => {
        const current = parse({ profile: { height: 170 }, activeCycleId: 'retained' });
        const result = prepareImport(current, { profile: { height: 180 }, legalConsent: { acceptedAt: '2026-09-01', termsVersion: '999' } }, 'restore');
        expect(result.data.profile?.height).toBe('180');
        expect(result.data.activeCycleId).toBe('retained');
        expect(result.data.legalConsent).toEqual(current.legalConsent);
    });
});
