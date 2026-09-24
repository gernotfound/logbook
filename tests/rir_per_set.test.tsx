import React from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackup, decodeImport, prepareImport } from '../src/lib/backup';
import { computeWorkoutReport } from '../src/lib/calc/workoutReport';
import { Exporter } from '../src/lib/export';
import { mergeUserData } from '../src/lib/merge';
import { UserDataSchema, WorkoutSessionSchema } from '../src/lib/schema';
import { SessionExerciseSetSchema } from '../src/lib/schemas/schema_training';
import {
    CURRENT_BACKUP_SCHEMA,
    CURRENT_DATA_SCHEMA,
    CURRENT_LOCAL_ENVELOPE,
    CURRENT_SYNC_PROTOCOL,
} from '../src/lib/schemaEvolution';
import { useWorkoutSetMutations } from '../src/hooks/workout/useWorkoutSetMutations';
import {
    prepareCompletedWorkout,
    prepareHistoricalWorkoutForEditing,
    prepareHistoricalWorkoutForSave,
} from '../src/hooks/workout/workoutSessionPreparation';
import SessionSetRow from '../src/components/Training/session/SessionSetRow';
import SessionExerciseCard from '../src/components/Training/session/SessionExerciseCard';
import TrainingHistory from '../src/components/Training/TrainingHistory';
import { getInitialLocalWorkout } from '../src/store/slices/createWorkoutSlice';
import { useAppStore } from '../src/store/useAppStore';
import { deviceKey } from '../src/lib/sync/deviceStorage';
import { applyDomainOperations, compileDomainOperations } from '../src/lib/sync/domainOperations';
import { projectDocuments } from '../src/lib/sync/documentProjection';
import { applySemanticOperations } from '../src/lib/sync/semanticProjection';
import type { CachedGlobalCatalog, UserData, WorkoutSession } from '../src/types';

vi.mock('../src/lib/telemetryHub', () => ({ telemetryHub: { trackEvent: vi.fn(), trackError: vi.fn() } }));

const parseUserData = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;
const catalog: CachedGlobalCatalog = {
    manifest: {
        version: 'rir-test', updatedAt: '2026-09-24T00:00:00.000Z', schemaVersion: 1,
        docRefs: { exercises: 'catalog/exercises', foods: 'catalog/foods' },
        itemCounts: { exercises: 0, foods: 0 },
    },
    exercises: [], foods: [], cachedAt: 0,
};
const session = (rir?: number): WorkoutSession => ({
    id: 'w-rir',
    routineId: 'r-1',
    routineName: 'Push',
    date: '2026-09-24',
    globalStartTime: 1_700_000_000_000,
    exercises: [{
        id: 'se-1',
        exId: 'bench',
        sessionNote: '',
        sets: [{ id: 's1', kg: '100', reps: '8', ...(rir !== undefined ? { rir } : {}) }],
    }],
});

describe('RIR reale per singola serie', () => {
    beforeEach(() => {
        localStorage.clear();
        useAppStore.setState({ userData: parseUserData({}), localWorkout: null });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('preserva 0, distingue assenza e sanitizza valori fuori dal contratto 0-10 intero', () => {
        expect(SessionExerciseSetSchema.parse({ id: 's', kg: '100', reps: '8', rir: 0 }).rir).toBe(0);
        expect(SessionExerciseSetSchema.parse({ id: 's', kg: '100', reps: '8', rir: 10 }).rir).toBe(10);
        const absent = SessionExerciseSetSchema.parse({ id: 's', kg: '100', reps: '8' });
        expect(absent.rir).toBeUndefined();
        expect(absent).not.toHaveProperty('rir');

        for (const invalid of [-1, 11, 1.5, '2', null]) {
            const parsed = SessionExerciseSetSchema.parse({ id: 's', kg: '100', reps: '8', rir: invalid });
            expect(parsed.rir).toBeUndefined();
            expect(parsed).not.toHaveProperty('rir');
            expect(parsed.kg).toBe('100');
            expect(parsed.reps).toBe('8');
        }

        expect(() => WorkoutSessionSchema.parse(session())).not.toThrow();
    });

    it('non richiede bump delle versioni persistite per il campo opzionale retrocompatibile', () => {
        expect(CURRENT_DATA_SCHEMA).toBe(1);
        expect(CURRENT_SYNC_PROTOCOL).toBe(1);
        expect(CURRENT_LOCAL_ENVELOPE).toBe(4);
        expect(CURRENT_BACKUP_SCHEMA).toBe(3);
    });

    it('permette selezione rapida inclusi 0 e 10 e cancellazione senza tastiera', () => {
        const onUpdateSet = vi.fn();
        const props = {
            set: { id: 's1', kg: '100', reps: '8' },
            sIndex: 0,
            exIndex: 0,
            trackingType: 'weight_reps',
            isOpenMenu: false,
            onToggleMenu: vi.fn(),
            onRemoveSet: vi.fn(),
            onUpdateSet,
            onAddSpecialSet: vi.fn(),
            onUpdateSpecialSet: vi.fn(),
            onRemoveSpecialSet: vi.fn(),
        };

        const { rerender } = render(<SessionSetRow {...props} />);
        const trigger = screen.getByRole('button', { name: 'RIR serie 1: non registrato' });
        expect((trigger as HTMLElement).style.minHeight).toBe('44px');
        fireEvent.click(trigger);
        const choices = screen.getAllByRole('menuitemradio');
        expect(choices).toHaveLength(11);
        expect((choices[0] as HTMLElement).style.minHeight).toBe('44px');
        fireEvent.click(screen.getByRole('menuitemradio', { name: '0' }));
        expect(onUpdateSet).toHaveBeenLastCalledWith('s1', 'rir', 0);

        rerender(<SessionSetRow {...props} set={{ ...props.set, rir: 10 }} />);
        fireEvent.click(screen.getByRole('button', { name: 'RIR serie 1: 10' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Non registrato' }));
        expect(onUpdateSet).toHaveBeenLastCalledWith('s1', 'rir', undefined);
    });

    it('non propone RIR sulle serie tracciate a tempo', () => {
        render(<SessionSetRow
            set={{ id: 'time-set', kg: '20', reps: '', time: '60' }}
            sIndex={0} exIndex={0} trackingType="time" isOpenMenu={false}
            onToggleMenu={vi.fn()} onRemoveSet={vi.fn()} onUpdateSet={vi.fn()}
            onAddSpecialSet={vi.fn()} onUpdateSpecialSet={vi.fn()} onRemoveSpecialSet={vi.fn()}
        />);
        expect(screen.queryByRole('button', { name: /RIR serie/ })).toBeNull();
    });

    it('rimuove semanticamente RIR senza perdere kg/reps e non assegna RIR ai segmenti speciali', () => {
        let workout = session(2);
        const setLocalWorkout = vi.fn((updater: (prev: WorkoutSession | null) => WorkoutSession | null) => {
            workout = updater(workout) as WorkoutSession;
        });
        const { result } = renderHook(() => useWorkoutSetMutations({
            setLocalWorkout,
            showConfirm: vi.fn(async () => true),
        }));

        act(() => result.current.updateSet(0, 's1', 'rir', 0));
        expect(workout.exercises[0].sets[0]).toMatchObject({ kg: '100', reps: '8', rir: 0 });
        act(() => result.current.updateSet(0, 's1', 'rir', undefined));
        expect(workout.exercises[0].sets[0]).not.toHaveProperty('rir');
        expect(workout.exercises[0].sets[0]).toMatchObject({ kg: '100', reps: '8' });

        render(<SessionSetRow
            set={{ id: 'special', kg: '80', reps: '10', rir: 1, dropsets: [{ id: 'd1', kg: '60', reps: '8' }], isometrics: [{ id: 'i1', kg: '40', time: '20' }] }}
            sIndex={1} exIndex={0} trackingType="weight_reps" isOpenMenu={false}
            onToggleMenu={vi.fn()} onRemoveSet={vi.fn()} onUpdateSet={vi.fn()}
            onAddSpecialSet={vi.fn()} onUpdateSpecialSet={vi.fn()} onRemoveSpecialSet={vi.fn()}
        />);
        expect(screen.getAllByRole('button', { name: /RIR serie/ })).toHaveLength(1);
    });

    it('persiste RIR nel draft locale e lo recupera senza convertire 0 in assenza', () => {
        vi.useFakeTimers();
        useAppStore.getState().setLocalWorkout(session(0));
        act(() => vi.runAllTimers());

        expect(JSON.parse(localStorage.getItem(deviceKey('workout')) || '{}').exercises[0].sets[0].rir).toBe(0);
        expect(getInitialLocalWorkout()?.exercises[0].sets[0].rir).toBe(0);
    });

    it('sincronizza activeWorkout, cancella RIR senza undefined e completa nello shard storico', () => {
        const before = parseUserData({ activeWorkout: null, history: [] });
        const active = session(0);
        const afterActive = applyDomainOperations(before, { type: 'active-workout.set', workout: active });
        const activeOps = compileDomainOperations(before, afterActive, { type: 'active-workout.set', workout: active }, catalog, 'actor-rir', 1, { 'actor-rir': 1 });
        const activeReplay = applySemanticOperations(projectDocuments(before, catalog), activeOps).documents;
        const activeRoot = activeReplay.get('');
        expect(activeRoot).toBeDefined();
        expect((activeRoot!.activeWorkout as any).exercises[0].sets[0].rir).toBe(0);

        const cleared = session();
        const afterClear = applyDomainOperations(afterActive, { type: 'active-workout.set', workout: cleared });
        const clearOps = compileDomainOperations(afterActive, afterClear, { type: 'active-workout.set', workout: cleared }, catalog, 'actor-rir', 2, { 'actor-rir': 2 });
        const clearReplay = applySemanticOperations(projectDocuments(afterActive, catalog), clearOps).documents;
        const clearRoot = clearReplay.get('');
        expect(clearRoot).toBeDefined();
        const clearedSet = (clearRoot!.activeWorkout as any).exercises[0].sets[0];
        expect(clearedSet).not.toHaveProperty('rir');
        expect(JSON.stringify(clearRoot!.activeWorkout)).not.toContain('"rir"');

        const finished = prepareCompletedWorkout(active, 1_700_000_060_000).finishedWorkout;
        const afterComplete = applyDomainOperations(afterActive, { type: 'workout.complete', workout: finished, activePains: [] });
        const completeOps = compileDomainOperations(afterActive, afterComplete, { type: 'workout.complete', workout: finished, activePains: [] }, catalog, 'actor-rir', 2, { 'actor-rir': 2 });
        const completeReplay = applySemanticOperations(projectDocuments(afterActive, catalog), completeOps).documents;
        const historyDoc = completeReplay.get('history_months/2026-09');
        expect(historyDoc).toBeDefined();
        expect((historyDoc!['w-rir'] as any).exercises[0].sets[0].rir).toBe(0);
        expect(completeReplay.get('')?.activeWorkout).toBeNull();
    });

    it('preserva RIR nel completamento e nella modifica dello storico', () => {
        const completed = prepareCompletedWorkout(session(0), 1_700_000_060_000).finishedWorkout;
        expect(completed.exercises[0].sets[0].rir).toBe(0);

        const editing = prepareHistoricalWorkoutForEditing(session(3));
        editing.exercises[0].sets[0].rir = 1;
        const saved = prepareHistoricalWorkoutForSave(editing, 'w-rir', { mood: '', pump: '', fatigue: '' }, '', '00:01:00');
        expect(saved.exercises[0].sets[0].rir).toBe(1);
    });

    it('round-trip backup/import e merge preservano RIR senza inventarlo negli allenamenti vecchi', () => {
        const data = parseUserData({ history: [session(0), { ...session(), id: 'legacy' }] });
        const backup = JSON.parse(JSON.stringify(createBackup(data, 'guest')));
        const restored = prepareImport(parseUserData({}), decodeImport(backup, 'guest').data, 'restore').data;
        expect(restored.history?.[0].exercises[0].sets[0].rir).toBe(0);
        expect(restored.history?.[1].exercises[0].sets[0]).not.toHaveProperty('rir');

        const merged = mergeUserData(parseUserData({ history: [] }), data);
        expect(merged.history?.find(w => w.id === 'w-rir')?.exercises[0].sets[0].rir).toBe(0);
    });

    it('esporta CSV con RIR subito dopo le ripetizioni, vuoto se assente e vuoto per dropset/isometrie', async () => {
        let csv = '';
        vi.spyOn(Exporter, 'downloadFile').mockImplementation(async (filename, value) => {
            if (filename === 'allenamenti.csv') csv = value;
            return true;
        });

        const workout = session(0);
        delete workout.globalStartTime;
        workout.exercises[0].sets.push({
            id: 's2', kg: '90', reps: '10',
            dropsets: [{ id: 'd1', kg: '70', reps: '6' }],
            isometrics: [{ id: 'i1', kg: '50', time: '15' }],
        });
        await Exporter.exportToCSV([workout], {}, [{ id: 'bench', name: 'Panca' }]);

        const rows = csv.trim().split('\n');
        expect(rows[0]).toContain('Ripetizioni,RIR,Tempo');
        expect(rows[1].split(',')[5]).toBe('0');
        expect(rows[2].split(',')[5]).toBe('""');
        expect(rows[3].split(',')[5]).toBe('""');
        expect(rows[4].split(',')[5]).toBe('""');
    });

    it('mostra RIR 0 anche nello storico completato senza inventarlo per serie legacy', () => {
        useAppStore.setState({
            userData: parseUserData({
                library: [{ id: 'bench', name: 'Panca', setsCount: 3, sets: [] }],
                history: [session(0), { ...session(), id: 'legacy', date: '2026-09-20' }],
            }),
        });
        render(<TrainingHistory />);
        expect(screen.getByText(/100kg×8 · 0 RIR/)).toBeTruthy();
        expect(screen.getByText(/100kg×8(?! · 0 RIR)/)).toBeTruthy();
    });

    it('mostra RIR nello storico esercizio e mantiene il dato effort separato dal confronto output', () => {
        render(<SessionExerciseCard
            exItem={{ exId: 'bench', sessionNote: '', sets: [{ id: 's-now', kg: '100', reps: '9', rir: 0 }] }}
            exIndex={0} totalExercises={1} libDef={{ id: 'bench', name: 'Panca', trackingType: 'weight_reps' }}
            pastWorkouts={[{ date: '2026-09-17', note: '', sets: [{ id: 's-prev', kg: '100', reps: '8', rir: 3 }] }]}
            isHistoryOpen={true} isSetupOpen={false} openSpecialMenuId={null}
            onToggleHistory={vi.fn()} onToggleSetup={vi.fn()} onRemoveExercise={vi.fn()}
            onUpdateSetupNote={vi.fn()} onUpdateSessionNote={vi.fn()} onAddSet={vi.fn()}
            onRemoveSet={vi.fn()} onUpdateSet={vi.fn()} onAddSpecialSet={vi.fn()}
            onUpdateSpecialSet={vi.fn()} onRemoveSpecialSet={vi.fn()} onToggleSpecialMenu={vi.fn()}
        />);
        expect(screen.getByText(/3 RIR/)).toBeTruthy();

        const current = session(0);
        current.exercises[0].sets[0].reps = '9';
        const previous = session(3);
        previous.id = 'w-prev';
        previous.date = '2026-09-17';
        const report = computeWorkoutReport(current, [previous], new Map([['bench', { id: 'bench', name: 'Panca' }]]));
        const comparison = report.exerciseComparisons[0];
        expect(comparison.repsDelta).toBe(1);
        expect(comparison.setEffortComparisons[0]).toMatchObject({ previousRir: 3, currentRir: 0 });
    });
});
