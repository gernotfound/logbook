import { describe, expect, it } from 'vitest';
import { parseRoutineRecovery } from '../../../src/lib/routineRecoverySchema';

describe('routine recovery schema boundary', () => {
    it('leaves a missing draft absent without inventing a new routine', () => {
        expect(parseRoutineRecovery(null)).toBeNull();
    });

    it('retains the exact editable payload, including pending set-count input and supported extension fields', () => {
        const draft = {
            name: 'Scheda sospesa',
            exercises: [{
                exId: 'bench',
                setsCount: '2.5',
                setPlans: [{
                    technique: 'dropset',
                    target: { type: 'reps', reps: 8, sourceSetId: 'set-1' },
                    segmentCount: 2,
                    extra: 'keep-plan-metadata',
                }],
                technicalStandard: 'Fermati al petto',
                progressionContract: { role: 'primary', metric: 'volume', extra: 'keep-contract-metadata' },
                extra: 'keep-exercise-metadata',
            }],
            extra: 'keep-draft-metadata',
        };

        expect(parseRoutineRecovery(draft)).toEqual(draft);
        expect(draft.exercises[0].setsCount).toBe('2.5');
    });

    it.each([
        { name: 12 },
        { exercises: {} },
        { exercises: [{ exId: '', setsCount: 3 }] },
        { exercises: [{ exId: 'bench', setsCount: Number.POSITIVE_INFINITY }] },
        { exercises: [{ exId: 'bench', setsCount: 3, setPlans: {} }] },
        { exercises: [{ exId: 'bench', setsCount: 3, progressionContract: { role: 'unknown' } }] },
    ])('rejects malformed recovery payloads instead of partially adopting them (%#)', invalid => {
        expect(() => parseRoutineRecovery(invalid)).toThrow('Bozza scheda non valida: originale cifrato conservato.');
    });
});
