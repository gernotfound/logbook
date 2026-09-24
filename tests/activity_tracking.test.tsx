import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { UserDataSchema } from '../src/lib/schema';
import { NutritionDaySchema } from '../src/lib/schemas/schema_nutrition';
import { applyDomainOperations, compileDomainOperations, type DomainOperation } from '../src/lib/sync/domainOperations';
import { applySemanticOperations } from '../src/lib/sync/semanticProjection';
import { projectDocuments } from '../src/lib/sync/documentProjection';
import { mergeNutrition } from '../src/lib/merge';
import { createBackup, decodeImport, prepareImport } from '../src/lib/backup';
import { computeWeeklyActivitySeries } from '../src/lib/calc/analytics';
import { localDateTimeToTimestamp } from '../src/lib/activity';
import { Logic } from '../src/lib/logic';
import { Exporter } from '../src/lib/export';
import { useDialogStore } from '../src/store/useDialogStore';
import { useAppStore } from '../src/store/useAppStore';
import { useActivityTracking } from '../src/hooks/useActivityTracking';
import type { CachedGlobalCatalog, CardioSession, UserData } from '../src/types';

const catalog: CachedGlobalCatalog = {
    manifest: { version: 'activity-test', updatedAt: '2026-09-24T00:00:00.000Z', schemaVersion: 1,
        docRefs: { exercises: 'catalog/exercises', foods: 'catalog/foods' }, itemCounts: { exercises: 0, foods: 0 } },
    exercises: [], foods: [], cachedAt: 0,
};

const parse = (value: unknown = {}): UserData => UserDataSchema.parse(value) as unknown as UserData;
const cardio = (id: string, durationMinutes = 30): CardioSession => ({ id, modality: 'bike', durationMinutes, intensity: 'moderate', source: 'manual' });
function compileConcurrent(before: UserData, operation: DomainOperation, actorId: string) {
    const after = applyDomainOperations(before, operation);
    return compileDomainOperations(before, after, operation, catalog, actorId, 1, { [actorId]: 1 });
}

function nutritionDayFromDocs(documents: Map<string, any>, date = '2026-09-24') {
    return documents.get('nutrition_months/2026-09')?.[date];
}

beforeEach(() => {
    useAppStore.getState().resetStore();
    useAppStore.setState({ userData: parse({}) });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('activity data model and domain operations', () => {
    it('stores zero steps as a real value and keeps missing steps undefined', () => {
        const missing = NutritionDaySchema.parse({ date: '2026-09-24' });
        expect(missing.steps).toBeUndefined();
        expect(NutritionDaySchema.parse({ date: '2026-09-24', steps: -1, stepsSource: 'manual', stepsCapturedAt: 123 }).steps).toBeUndefined();
        const saved = applyDomainOperations(parse({}), { type: 'activity-steps.set', date: '2026-09-24', steps: 0, source: 'manual', capturedAt: 123 });
        expect(saved.nutrition?.['2026-09-24']).toMatchObject({ steps: 0, stepsSource: 'manual', stepsCapturedAt: 123 });
        const cleared = applyDomainOperations(saved, { type: 'activity-steps.clear', date: '2026-09-24' });
        expect(cleared.nutrition?.['2026-09-24']?.steps).toBeUndefined();
        expect(cleared.nutrition?.['2026-09-24']?.stepsSource).toBeUndefined();
    });

    it('rejects negative/fractional steps and invalid cardio values at the domain boundary', () => {
        expect(() => applyDomainOperations(parse({}), { type: 'activity-steps.set', date: '2026-09-24', steps: -1 })).toThrow(/Passi/);
        expect(() => applyDomainOperations(parse({}), { type: 'activity-steps.set', date: '2026-09-24', steps: 1.5 })).toThrow(/Passi/);
        expect(() => applyDomainOperations(parse({}), { type: 'cardio-session.upsert', date: '2026-09-24', session: { ...cardio('c1'), durationMinutes: 0 } })).toThrow();
    });    it('quarantines malformed cardio records without inventing identities or losing valid siblings', () => {
        const day = NutritionDaySchema.parse({
            date: '2026-09-24',
            cardioSessions: [cardio('valid'), { modality: 'bike', durationMinutes: 20 }, { ...cardio('bad'), durationMinutes: -2 }, cardio('valid', 99)],
        });
        expect(day.cardioSessions).toEqual([cardio('valid')]);
    });

    it('keeps existing workout cardio fields untouched', () => {
        const data = parse({ history: [{ id: 'w1', date: '2026-09-24', exercises: [{ exId: 'run', sessionNote: '', sets: [{ id: 's1', kg: '', reps: '', time: '1200', distance: '2.1', speed: '6', incline: '2', kcal: '140' }] }] }] });
        expect(data.history?.[0]?.exercises[0]?.sets[0]).toMatchObject({ time: '1200', distance: '2.1', speed: '6', incline: '2', kcal: '140' });
    });
});

describe('activity semantic merge concurrency', () => {
    it('converges a steps edit with an unrelated daily field edit without overwriting either', () => {
        const before = parse({});
        const stepsOps = compileConcurrent(before, { type: 'activity-steps.set', date: '2026-09-24', steps: 10000, source: 'manual', capturedAt: 1 }, 'device-a');
        const sleepOps = compileConcurrent(before, { type: 'nutrition-day.patch', date: '2026-09-24', patch: { sleepHours: '07:30' } }, 'device-b');
        const docs = applySemanticOperations(projectDocuments(before, catalog), [...stepsOps, ...sleepOps]).documents;
        expect(nutritionDayFromDocs(docs)).toMatchObject({ steps: 10000, sleepHours: '07:30' });
    });

    it('merges two concurrently created cardio sessions by stable ID', () => {
        const before = parse({});
        const a = compileConcurrent(before, { type: 'cardio-session.upsert', date: '2026-09-24', session: cardio('a', 30) }, 'device-a');
        const b = compileConcurrent(before, { type: 'cardio-session.upsert', date: '2026-09-24', session: cardio('b', 40) }, 'device-b');
        const sessions = nutritionDayFromDocs(applySemanticOperations(projectDocuments(before, catalog), [...a, ...b]).documents).cardioSessions;
        expect(new Map(sessions.map((item: CardioSession) => [item.id, item.durationMinutes]))).toEqual(new Map([['a', 30], ['b', 40]]));
    });    it('preserves an update to one session while another device creates a different session', () => {
        const before = parse({ nutrition: { '2026-09-24': { date: '2026-09-24', cardioSessions: [cardio('a', 20)] } } });
        const updateA = compileConcurrent(before, { type: 'cardio-session.upsert', date: '2026-09-24', session: cardio('a', 35) }, 'device-a');
        const createB = compileConcurrent(before, { type: 'cardio-session.upsert', date: '2026-09-24', session: cardio('b', 45) }, 'device-b');
        const sessions = nutritionDayFromDocs(applySemanticOperations(projectDocuments(before, catalog), [...updateA, ...createB]).documents).cardioSessions;
        expect(new Map(sessions.map((item: CardioSession) => [item.id, item.durationMinutes]))).toEqual(new Map([['a', 35], ['b', 45]]));
    });

    it('applies the current causal policy: a concurrent delete wins over an update and converges independent of delivery order', () => {
        const before = parse({ nutrition: { '2026-09-24': { date: '2026-09-24', cardioSessions: [cardio('a', 20)] } } });
        const update = compileConcurrent(before, { type: 'cardio-session.upsert', date: '2026-09-24', session: cardio('a', 50) }, 'device-a');
        const remove = compileConcurrent(before, { type: 'cardio-session.delete', date: '2026-09-24', sessionId: 'a' }, 'device-b');
        const baseDocs = projectDocuments(before, catalog);
        const first = applySemanticOperations(baseDocs, [...update, ...remove]).documents;
        const second = applySemanticOperations(baseDocs, [...remove, ...update]).documents;
        expect(nutritionDayFromDocs(first).cardioSessions).toEqual([]);
        expect(nutritionDayFromDocs(second).cardioSessions).toEqual([]);
    });
});describe('activity guest merge, backup and analytics', () => {
    it('merges cardio by ID and keeps step provenance tied to the winning value during guest→account merge', () => {
        const cloud = { '2026-09-24': { date: '2026-09-24', steps: 9000, stepsSource: 'imported', stepsCapturedAt: 10, cardioSessions: [cardio('a', 20)] } } as any;
        const guest = { '2026-09-24': { date: '2026-09-24', steps: 0, stepsSource: 'manual', stepsCapturedAt: 20, cardioSessions: [cardio('a', 25), cardio('b', 30)] } } as any;
        const day = mergeNutrition(cloud, guest)['2026-09-24'];
        expect(day).toMatchObject({ steps: 0, stepsSource: 'manual', stepsCapturedAt: 20 });
        expect(new Map(day.cardioSessions?.map(item => [item.id, item.durationMinutes]))).toEqual(new Map([['a', 25], ['b', 30]]));
    });

    it('round-trips activity through the versioned backup/import boundary', () => {
        const data = parse({ nutrition: { '2026-09-24': { date: '2026-09-24', steps: 8421, stepsSource: 'manual', stepsCapturedAt: 123, cardioSessions: [cardio('c1', 35)] } } });
        const payload = JSON.parse(JSON.stringify(createBackup(data, 'user:a')));
        const restored = prepareImport(parse({}), decodeImport(payload, 'user:a').data, 'restore').data;
        expect(restored.nutrition?.['2026-09-24']).toMatchObject({ steps: 8421, stepsSource: 'manual', stepsCapturedAt: 123, cardioSessions: [cardio('c1', 35)] });
        payload.userData.nutrition['2026-09-24'].cardioSessions = [{ modality: 'bike', durationMinutes: 20 }];
        expect(() => decodeImport(payload, 'user:a')).toThrow(/identificativo/);
    });    it('computes weekly steps from recorded days only and reports week-to-date completeness', () => {
        const nutrition = {
            '2026-09-21': { date: '2026-09-21', steps: 10000 },
            '2026-09-24': { date: '2026-09-24', steps: 8000, cardioSessions: [cardio('a', 30), { ...cardio('b', 15), intensity: 'low' }] },
        } as any;
        const point = computeWeeklyActivitySeries(nutrition, 1, '2026-09-24').points[0];
        expect(point).toMatchObject({ averageSteps: 9000, totalSteps: 18000, stepDaysCount: 2, daysConsidered: 4, cardioMinutes: 45, cardioSessionsCount: 2 });
        expect(point.cardioMinutesByIntensity).toMatchObject({ low: 15, moderate: 30, high: 0 });
    });

    it('counts an explicit zero-step day as recorded instead of treating it as missing', () => {
        const point = computeWeeklyActivitySeries({ '2026-09-24': { date: '2026-09-24', steps: 0 } } as any, 1, '2026-09-24').points[0];
        expect(point.averageSteps).toBe(0);
        expect(point.stepDaysCount).toBe(1);
        expect(point.daysConsidered).toBe(4);
        const missing = computeWeeklyActivitySeries({}, 1, '2026-09-24').points[0];
        expect(missing.averageSteps).toBeNull();
        expect(missing.stepDaysCount).toBe(0);
    });
});

describe('activity export and local-day behavior', () => {
    it('exports steps and standalone cardio as separate CSV files', async () => {
        vi.useFakeTimers();
        const download = vi.spyOn(Exporter, 'downloadFile').mockImplementation(async () => true);
        vi.spyOn(useDialogStore.getState(), 'showAlert').mockImplementation(() => undefined as any);
        await Exporter.exportToCSV([], {
            '2026-09-24': { date: '2026-09-24', steps: 9842, stepsSource: 'manual', stepsCapturedAt: 1000, cardioSessions: [{ ...cardio('c1', 35), averageHeartRate: 132, distanceKm: 2.1 }] },
        }, []);
        await vi.advanceTimersByTimeAsync(1600);
        const byName = new Map(download.mock.calls.map(call => [call[0], call[1]]));
        expect(byName.get('passi.csv')).toContain('9842');
        expect(byName.get('cardio.csv')).toContain('c1');
        expect(byName.get('cardio.csv')).toContain('132');
        expect(byName.get('misurazioni.csv')).not.toContain('c1');
    });

    it('combines an optional cardio start time with the selected local business date', () => {
        const timestamp = localDateTimeToTimestamp('2026-09-24', '18:30');
        expect(timestamp).toBeDefined();
        expect(Logic.getLocalDateString(timestamp!)).toBe('2026-09-24');
        expect(localDateTimeToTimestamp('2026-09-24', '25:00')).toBeUndefined();
    });
    it('rolls activity to the next local day at midnight without turning missing steps into zero', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 8, 24, 23, 59, 59));
        useAppStore.setState({ userData: parse({ nutrition: { '2026-09-24': { date: '2026-09-24', steps: 7777 } } }) });
        const hook = renderHook(() => useActivityTracking());
        expect(hook.result.current.selectedDate).toBe('2026-09-24');
        expect(hook.result.current.savedSteps).toBe(7777);
        act(() => vi.advanceTimersByTime(1100));
        expect(hook.result.current.selectedDate).toBe('2026-09-25');
        expect(hook.result.current.savedSteps).toBeUndefined();
        expect(hook.result.current.steps).toBe('');
    });

    it('edits a legitimate cardio session whose stable id is "new" instead of treating it as a draft sentinel', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 8, 24, 12, 0, 0));
        useAppStore.setState({ userData: parse({ nutrition: {
            '2026-09-24': { date: '2026-09-24', cardioSessions: [{ ...cardio('new', 42), notes: 'existing' }] },
        } }) });
        const hook = renderHook(() => useActivityTracking());
        act(() => hook.result.current.editCardio('new'));
        expect(hook.result.current.isCreatingCardio).toBe(false);
        expect(hook.result.current.cardioForm.durationMinutes).toBe('42');
        expect(hook.result.current.cardioForm.notes).toBe('existing');
    });

});
