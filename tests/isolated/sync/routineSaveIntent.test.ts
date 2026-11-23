import { describe, expect, it } from 'vitest';
import { UserDataSchema } from '../../../src/lib/schema';
import { applyDomainOperations } from '../../../src/lib/sync/domainOperations';
import {
    buildRoutineDuplicateOperation, buildRoutineSaveOperations, routineDraftValidationError,
} from '../../../src/lib/routineSaveIntent';
import type { RoutineExercise, UserData, WorkoutRoutine } from '../../../src/types';

const routine = (id: string, name: string, exercises: RoutineExercise[] = []): WorkoutRoutine =>
    ({ id, name, exercises });
const initial = (routines: WorkoutRoutine[]): UserData =>
    UserDataSchema.parse({ routines }) as unknown as UserData;

describe('routine editor domain intents shared by guest and Kinde', () => {
    it('rejects malformed names, identities, sets and segments before mutation', () => {
        expect(routineDraftValidationError('   ', [])).toBe('Inserisci il nome della scheda');
        expect(routineDraftValidationError('Scheda', [{ exId: '/', setsCount: 3 }]))
            .toContain('identificativo non valido');
        expect(routineDraftValidationError('Scheda', [
            { exId: 'a', setsCount: 3 }, { exId: ' a ', setsCount: 3 },
        ])).toContain('due volte');
        for (const invalid of ['', '00', 0, -1, 21, Number.NaN, '2.5', ' 3 ']) {
            expect(routineDraftValidationError('Scheda', [{ exId: 'a', setsCount: invalid }]))
                .toContain('da 1 a 20 serie');
        }
        for (const segmentCount of [1, 21, Number.NaN, 2.5]) {
            expect(routineDraftValidationError('Scheda', [
                { exId: 'a', setsCount: 3, setPlans: [{ technique: 'cluster', segmentCount }] },
            ])).toContain('da 2 a 20 segmenti');
        }
        expect(routineDraftValidationError('Scheda', [
            { exId: 'a', setsCount: '3', setPlans: [{ technique: 'cluster', segmentCount: 2 }] },
        ])).toBeNull();
    });

    it('compiles create and its deterministic name ordering into domain operations', () => {
        const current = [routine('z', 'Zeta'), routine('b', 'Beta')];
        const exercises: RoutineExercise[] = [{
            exId: 'squat', setsCount: '3', minReps: 6, maxReps: 10,
            setPlans: [{ technique: 'straight' }, { technique: 'straight' }, { technique: 'straight' }],
        }];
        const before = structuredClone({ current, exercises });
        const ops = buildRoutineSaveOperations({
            name: '  Alpha  ', exercises, routines: current, createId: 'new-id',
        });
        expect(ops).toEqual([
            { type: 'routine.upsert', routine: {
                id: 'new-id', name: 'Alpha',
                exercises: [{ ...exercises[0], setsCount: 3 }],
            } },
            { type: 'routine.reorder', ids: ['new-id', 'b', 'z'] },
        ]);
        const reduced = applyDomainOperations(initial(current), ops);
        expect(reduced.routines?.map(item => item.id)).toEqual(['new-id', 'b', 'z']);
        expect(reduced.routines?.[0].exercises[0].setsCount).toBe(3);
        expect({ current, exercises }).toEqual(before);
    });

    it('modifies only the selected routine, preserving its identity and other routines', () => {
        const current = [routine('old', 'Original', [{ exId: 'squat', setsCount: 2 }]), routine('other', 'Altra')];
        const ops = buildRoutineSaveOperations({
            name: '  Modificata ', exercises: [{ exId: 'squat', setsCount: '5' }],
            routines: current, editingRoutineId: 'old',
        });
        expect(ops).toEqual({ type: 'routine.edit',
            id: 'old', name: 'Modificata', exercises: [{ exId: 'squat', setsCount: 5 }],
        });
        const withNewMetadata = { ...current[0], newMetadata: { label: 'da conservare' } };
        const reduced = applyDomainOperations(initial([withNewMetadata, current[1]]), ops);
        expect(reduced.routines?.map(item => item.id)).toEqual(['old', 'other']);
        expect(reduced.routines?.[0]).toMatchObject({ name: 'Modificata', newMetadata: withNewMetadata.newMetadata });
        expect(reduced.routines?.[1]).toEqual(current[1]);
        expect(current[0].name).toBe('Original');
    });

    it('rejects an intent prepared before deletion when the archive has since removed that routine', () => {
        const current = [routine('existing', 'Scheda'), routine('other', 'Altra')];
        const edit = buildRoutineSaveOperations({
            name: 'Modificata', exercises: [], routines: current, editingRoutineId: 'existing',
        });
        const afterDelete = applyDomainOperations(initial(current), { type: 'routine.delete', id: 'existing' });
        expect(() => applyDomainOperations(afterDelete, edit)).toThrow('Routine non trovata');
        expect(afterDelete.routines).toEqual([current[1]]);
    });

    it('refuses a stale edit, invalid new ID or duplicate ID without a fallback snapshot save', () => {
        const current = [routine('existing', 'Scheda')];
        expect(() => buildRoutineSaveOperations({
            name: 'Nome', exercises: [], routines: current, editingRoutineId: 'missing',
        })).toThrow('Routine non trovata');
        for (const createId of [undefined, '/', 'existing', ' new ']) {
            expect(() => buildRoutineSaveOperations({
                name: 'Nome', exercises: [], routines: current, createId,
            })).toThrow('Identificativo nuova scheda');
        }
        expect(() => buildRoutineSaveOperations({
            name: 'Nome', exercises: [{ exId: 'x', setsCount: 0 }],
            routines: current, createId: 'new',
        })).toThrow('da 1 a 20 serie');
    });

    it('duplicates with an independently owned deep copy and no new write to the original identity', () => {
        const source = routine('original', 'Scheda', [{
            exId: 'x', setsCount: 3, setPlans: [{ technique: 'cluster', segmentCount: 2 }],
        }]);
        const current = [source, routine('existing', 'Scheda - 1')];
        const op = buildRoutineDuplicateOperation(source, current, 'clone');
        expect(op).toEqual({
            type: 'routine.upsert', routine: {
                id: 'clone', name: 'Scheda - 2', exercises: source.exercises,
            },
        });
        const result = applyDomainOperations(initial(current), op);
        expect(result.routines).toHaveLength(3);
        expect(result.routines?.find(item => item.id === 'clone')?.name).toBe('Scheda - 2');
        expect(source.name).toBe('Scheda');
        if (op.type !== 'routine.upsert') throw Error('Expected upsert');
        expect(op.routine.exercises).not.toBe(source.exercises);
        expect(op.routine.exercises[0].setPlans).not.toBe(source.exercises[0].setPlans);
        expect(() => buildRoutineDuplicateOperation(source, current, 'existing')).toThrow('duplicazione');
    });
});
