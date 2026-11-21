import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyUserData } from '../../setup';
import { UserDataSchema } from '../../../src/lib/schema';
import { captureSession } from '../../../src/lib/sync/session';
import { initializeLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { useAppStore } from '../../../src/store/useAppStore';
import { useNutritionMeasurements } from '../../../src/hooks/useNutritionMeasurements';
import { calculateBodyFatByMethod } from '../../../src/lib/calc/bodyFat';
import { parseMeasurementNumber, prepareBodyMeasurements } from '../../../src/lib/nutrition/measurementInput';

const DATE = '2026-09-24';
const metrics = {
    weight: '75',
    waist: '85,5',
    neck: '38',
    hip: '',
    chest: '',
    shoulders: '',
    biceps: '',
    thighs: '',
    calves: '',
};

describe('measurement inputs and Navy provenance', () => {
    it('uses one strict decimal grammar for body metrics and the Navy formula', () => {
        expect(prepareBodyMeasurements(metrics)).toEqual({
            ok: true,
            values: {
                weight: 75, waist: 85.5, neck: 38, hip: undefined,
                chest: undefined, shoulders: undefined,
                biceps: undefined, thighs: undefined, calves: undefined,
            },
        });
        expect(parseMeasurementNumber('180,5')).toBe(180.5);
        for (const raw of ['0x55', '0b101', '8.5e1', '85cm', '85.2.1', 'Infinity', ' ']) {
            expect(parseMeasurementNumber(raw)).toBeNull();
            expect(prepareBodyMeasurements({ ...metrics, waist: raw })).toEqual({
                ok: false, reason: 'optional',
            });
            expect(calculateBodyFatByMethod('navy_male', {
                height: 180, waist: raw, neck: 38,
            })).toBeNull();
        }
        expect(prepareBodyMeasurements({ ...metrics, weight: '7.5e1' })).toEqual({
            ok: false, reason: 'weight',
        });
        expect(prepareBodyMeasurements({ ...metrics, neck: '0' })).toEqual({
            ok: false, reason: 'optional',
        });
    });

    describe('durable measurement save', () => {
        let owner: string;
        beforeEach(async () => {
            localStorage.clear();
            owner = captureSession().owner;
            localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '1');
            useAppStore.getState().resetStore();
            await prepareUnlockedTestArchive(owner);
            const initial = UserDataSchema.parse({
                ...emptyUserData,
                profile: { height: '180', gender: 'M' },
                nutrition: {},
            });
            await initializeLocal(owner, initial);
            useAppStore.setState({ userData: initial, dataOwner: owner, localPersistenceBlocked: false });
        });
        afterEach(() => {
            localStorage.clear();
            useAppStore.getState().resetStore();
            vi.restoreAllMocks();
        });

        it('rejects non-decimal circumference before any durable domain commit and retains its draft', async () => {
            const { result } = renderHook(() => useNutritionMeasurements(DATE));
            act(() => {
                result.current.setWeight('75');
                result.current.setWaist('0x55');
                result.current.setNeck('38');
            });
            await act(async () => {
                expect(await result.current.calculateAndSave(undefined, true)).toBe(false);
            });
            expect(result.current.waist).toBe('0x55');
            expect(useAppStore.getState().userData?.nutrition?.[DATE]).toBeUndefined();
            expect((await readLocal(owner))?.data.nutrition?.[DATE]).toBeUndefined();
        });

        it('commits a canonical decimal and matching BF provenance to the sealed local archive', async () => {
            const { result } = renderHook(() => useNutritionMeasurements(DATE));
            act(() => {
                result.current.setWeight(metrics.weight);
                result.current.setWaist(metrics.waist);
                result.current.setNeck(metrics.neck);
            });
            await act(async () => {
                expect(await result.current.calculateAndSave(undefined, true)).toBe(true);
            });

            const expected = calculateBodyFatByMethod('navy_male', {
                height: 180, waist: 85.5, neck: 38,
            });
            expect(expected).not.toBeNull();
            const memory = useAppStore.getState().userData?.nutrition?.[DATE];
            const durable = (await readLocal(owner))?.data.nutrition?.[DATE];
            for (const day of [memory, durable]) {
                expect(day?.weight).toBe(75);
                expect(day?.waist).toBe(85.5);
                expect(day?.neck).toBe(38);
                expect(day?.bf).toBe(expected);
                expect(day?.bfProvenance).toEqual({
                    method: 'us_navy',
                    inputs: { heightCm: 180, waistCm: 85.5, neckCm: 38, gender: 'M' },
                });
            }
        });
    });
});
