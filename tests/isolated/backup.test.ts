import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/lib/telemetryHub', () => ({ telemetryHub: { trackEvent: vi.fn(), trackError: vi.fn() } }));
import { createBackup, decodeImport, prepareImport } from '../../src/lib/backup';
import { UserDataSchema } from '../../src/lib/schema';
import type { UserData } from '../../src/types';
const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;

describe('versioned backup and non-mutating restore', () => {
    it('round-trips every field, unknown extensions and recovery metadata over 24 months', () => {
        const data = parse({ profile: { height: 180 }, customFoods: [{ id: 0, name: 'A' }], activeCycleId: 'c',
            activePains: ['knee'], nutritionPlanningOrigin: 'user-edited', pendingConflicts: { nutritionPlanning: { onDaysCount: 0 } },
            catalogOverrides: { foods: { '0': { name: 'Override' } }, hiddenFoodIds: ['x'] }, extension: { flag: true },
            history: Array.from({ length: 24 }, (_, index) => ({ id: 'h' + index, date: (2024 + Math.floor(index / 12)) + '-' + String(index % 12 + 1).padStart(2, '0') + '-01' })) });
        const backup = JSON.parse(JSON.stringify(createBackup(data, 'user:A', { scope: 'cloud-and-device', months: [] }, { device: { workout: 'draft' } })));
        const restored = prepareImport(parse({}), decodeImport(backup, 'user:A').data, 'restore').data;
        expect(backup.userData).toEqual(JSON.parse(JSON.stringify(data)));
        expect(restored).toEqual(parse(data));
        expect(backup.recovery.device.workout).toBe('draft');
        expect(restored.history).toHaveLength(24);
    });
    it('reads the legacy emergency format and fills an empty default profile', () => {
        const incoming = decodeImport({ format: 'logbook-backup', version: 1, userData: { profile: { height: 181 }, activePains: ['a'] } }, 'guest');
        expect(incoming.ownerUnknown).toBe(true);
        expect(prepareImport(parse({}), incoming.data, 'merge').data.profile?.height).toBe('181');
    });
    it('rejects cross-account imports even when currently guest', () => {
        const payload = createBackup(parse({}), 'user:A');
        for (const owner of ['user:B', 'guest']) expect(() => decodeImport(payload, owner)).toThrow('altro utente');
    });
    it.each([{ history: {} }, { routines: [null] }, { nutrition: { '2026-02-30': {} } }, { library: [{ id: 'a' }, { id: 'a' }] }, { customFoods: [{ name: 'lost' }] }])('rejects malformed identities/containers without mutation: %j', data => {
        expect(() => decodeImport({ version: 1, type: 'backup', ...data }, 'guest')).toThrow();
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
    it('restore replaces only included legacy fields and never imports legal acceptance', () => {
        const current = parse({ profile: { height: 170 }, activeCycleId: 'retained' });
        const result = prepareImport(current, { profile: { height: 180 }, legalConsent: { acceptedAt: '2026-09-01', termsVersion: '999' } }, 'restore');
        expect(result.data.profile?.height).toBe('180');
        expect(result.data.activeCycleId).toBe('retained');
        expect(result.data.legalConsent).toEqual(current.legalConsent);
    });
});
