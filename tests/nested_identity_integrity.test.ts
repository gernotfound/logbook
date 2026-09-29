import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/telemetryHub', () => ({
    telemetryHub: { trackEvent: vi.fn(), trackError: vi.fn() },
}));

import type { UserData } from '../src/types';
import { DomainParsers, UserDataSchema } from '../src/lib/schema';
import { createBackup, decodeImport } from '../src/lib/backup';
import { applyDomainOperations } from '../src/lib/sync/domainOperations';

describe('nested business identity integrity outside nutrition', () => {
    it('quarantines malformed routine exercises and preserves valid siblings', () => {
        const routines = DomainParsers.parseRoutines([{
            id: 'routine-1',
            name: 'Upper',
            exercises: [
                { exId: 'bench', setsCount: 3 },
                { exId: '', setsCount: 4 },
                { setsCount: 2 },
                { exId: 'bench', setsCount: 5 },
            ],
        }]);

        expect(routines).toHaveLength(1);
        expect(routines[0].exercises).toEqual([{ exId: 'bench', setsCount: 3 }]);

        const next = applyDomainOperations({ routines } as UserData, {
            type: 'routine-exercise.upsert',
            routineId: 'routine-1',
            exercise: { exId: 'row', setsCount: 3 },
        });
        expect(next.routines?.[0].exercises.map(item => item.exId)).toEqual(['bench', 'row']);
    });

    it('quarantines malformed training-cycle routine references and preserves valid siblings', () => {
        const cycles = DomainParsers.parseTrainingCycles([{
            id: 'cycle-1',
            name: 'Blocco',
            durationWeeks: 4,
            routines: [
                { routineId: 'routine-1', frequencyPerWeek: 2 },
                { routineId: '', frequencyPerWeek: 1 },
                { frequencyPerWeek: 1 },
                { routineId: 'routine-1', frequencyPerWeek: 3 },
            ],
        }]);

        expect(cycles).toHaveLength(1);
        expect(cycles[0].routines).toEqual([{ routineId: 'routine-1', frequencyPerWeek: 2 }]);

        const next = applyDomainOperations({ trainingCycles: cycles } as UserData, {
            type: 'training-cycle-routine.upsert',
            cycleId: 'cycle-1',
            routine: { routineId: 'routine-2', frequencyPerWeek: 1 },
        });
        expect(next.trainingCycles?.[0].routines.map(item => item.routineId)).toEqual(['routine-1', 'routine-2']);
    });

    it('rejects malformed nested routine identities at the backup boundary', () => {
        const backup = createBackup(UserDataSchema.parse({}) as unknown as UserData, 'guest') as any;
        backup.userData = {
            routines: [{
                id: 'routine-1',
                name: 'Upper',
                exercises: [{ exId: '', setsCount: 3 }],
            }],
        };
        expect(() => decodeImport(backup, 'guest')).toThrow(/esercizio senza identificativo valido/i);

        backup.userData = {
            trainingCycles: [{
                id: 'cycle-1',
                name: 'Blocco',
                durationWeeks: 4,
                routines: [{ routineId: '', frequencyPerWeek: 1 }],
            }],
        };
        expect(() => decodeImport(backup, 'guest')).toThrow(/routine senza identificativo valido/i);
    });
});
