import { describe, expect, it } from 'vitest';
import {
    computeEndDate,
    computeWeeksFromDates,
    prepareCycleSubmission,
    type CycleFormSubmissionInput,
} from '../../../src/components/Training/planning/cycleFormModel';

const validInput: CycleFormSubmissionInput = {
    name: '  Mesociclo  ',
    cycleRoutines: [{ routineId: 'r1', frequencyPerWeek: 1 }],
    strategyIntent: '',
    progressionFocus: '',
    durationWeeks: '4',
    sessionsPerWeek: '3',
    dateTextInput: '20/08/2026',
    endDateTextInput: '16/09/2026',
    notes: '  Note  ',
    primaryMuscles: [],
    secondaryMuscles: [],
};

describe('cycle form model: validated fields before durable save', () => {
    it('normalizes form fields without allocating identity or changing date semantics', () => {
        const result = prepareCycleSubmission(validInput);
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.message);
        expect(result.fields).toEqual({
            name: 'Mesociclo',
            durationWeeks: 4,
            sessionsPerWeek: 3,
            startDate: '2026-08-20',
            endDate: '2026-09-16',
            notes: 'Note',
            routines: validInput.cycleRoutines,
        });
        expect(computeEndDate('2026-08-20', 4)).toBe('2026-09-16');
        expect(computeWeeksFromDates('2026-08-20', '2026-09-16')).toBe(4);
    });

    it.each([
        ['blank name', { name: '   ' }, 'Inserisci un nome per il ciclo di allenamento.'],
        ['missing routine', { cycleRoutines: [] }, 'Aggiungi almeno una scheda al ciclo di allenamento.'],
        ['missing focus', { strategyIntent: 'development' }, 'Seleziona cosa vuoi far progredire principalmente.'],
        ['fractional duration', { durationWeeks: '1.5' }, 'Il ciclo deve durare da 1 a 52 settimane e prevedere da 1 a 14 sedute intere a settimana.'],
        ['nonfinite duration', { durationWeeks: 'Infinity' }, 'Il ciclo deve durare da 1 a 52 settimane e prevedere da 1 a 14 sedute intere a settimana.'],
        ['excess duration', { durationWeeks: '53' }, 'Il ciclo deve durare da 1 a 52 settimane e prevedere da 1 a 14 sedute intere a settimana.'],
        ['fractional weekly sessions', { sessionsPerWeek: '3.5' }, 'Il ciclo deve durare da 1 a 52 settimane e prevedere da 1 a 14 sedute intere a settimana.'],
        ['excess weekly sessions', { sessionsPerWeek: '15' }, 'Il ciclo deve durare da 1 a 52 settimane e prevedere da 1 a 14 sedute intere a settimana.'],
        ['invalid end date', { endDateTextInput: '31/02/2026' }, 'Inserisci date di inizio e fine valide, con la fine non precedente all’inizio.'],
        ['invalid start date', { dateTextInput: '31/02/2026' }, 'Inserisci date di inizio e fine valide, con la fine non precedente all’inizio.'],
        ['inverted interval', { endDateTextInput: '19/08/2026' }, 'Inserisci date di inizio e fine valide, con la fine non precedente all’inizio.'],
    ] as Array<[string, Partial<CycleFormSubmissionInput>, string]>)(
        'rejects %s without creating fields', (_label, overrides, message) => {
            expect(prepareCycleSubmission({ ...validInput, ...overrides })).toEqual({ ok: false, message });
        },
    );

    it.each([
        ['', 4, '2026-09-16'],
        ['0', 1, '2026-08-26'],
        ['-8', 1, '2026-08-26'],
    ])('recomputes the end date for nonpositive or blank weeks %s', (durationWeeks, weeks, endDate) => {
        const result = prepareCycleSubmission({ ...validInput, durationWeeks });
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.message);
        expect(result.fields.durationWeeks).toBe(weeks);
        expect(result.fields.endDate).toBe(endDate);
    });

    it('accepts both exact upper bounds without overriding a valid edited end date', () => {
        const result = prepareCycleSubmission({
            ...validInput, durationWeeks: '52', sessionsPerWeek: '14',
        });
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.message);
        expect(result.fields).toMatchObject({
            durationWeeks: 52, sessionsPerWeek: 14, endDate: '2026-09-16',
        });
    });

    it('defaults blank weekly sessions to the selected routine count', () => {
        const routines = [
            { routineId: 'r1', frequencyPerWeek: 1 },
            { routineId: 'r2', frequencyPerWeek: 1 },
        ];
        const result = prepareCycleSubmission({
            ...validInput, cycleRoutines: routines, sessionsPerWeek: ' ',
        });
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.message);
        expect(result.fields.sessionsPerWeek).toBe(2);
        expect(result.fields.routines).toEqual(routines);
    });

    it('uses inclusive calendar weeks across leap day and year boundaries', () => {
        expect(computeEndDate('2024-02-26', 1)).toBe('2024-03-03');
        expect(computeWeeksFromDates('2024-02-26', '2024-03-03')).toBe(1);
        expect(computeEndDate('2024-12-30', 2)).toBe('2025-01-12');
        expect(computeWeeksFromDates('2024-12-30', '2025-01-12')).toBe(2);
        expect(computeWeeksFromDates('2024-12-30', '2025-01-13')).toBe(3);
    });

    it('preserves an explicit end-date edit when the duration is positive', () => {
        const result = prepareCycleSubmission({ ...validInput, endDateTextInput: '28/09/2026' });
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.message);
        expect(result.fields.endDate).toBe('2026-09-28');
        expect(result.fields.durationWeeks).toBe(4);
    });

    it('retains editable strategy details, but excludes irrelevant progression focus', () => {
        const development = prepareCycleSubmission({
            ...validInput,
            strategyIntent: 'development',
            progressionFocus: 'volume',
            primaryMuscles: ['chest'],
            secondaryMuscles: ['back'],
        });
        expect(development.ok).toBe(true);
        if (!development.ok) throw new Error(development.message);
        expect(development.fields.strategy).toEqual({
            intent: 'development',
            progressionFocus: 'volume',
            primaryMuscles: ['chest'],
            secondaryMuscles: ['back'],
        });
        const primaryMuscles = ['chest'];
        const secondaryMuscles = ['back'];
        const copied = prepareCycleSubmission({
            ...validInput, strategyIntent: 'development', progressionFocus: 'volume',
            primaryMuscles, secondaryMuscles,
        });
        expect(copied.ok).toBe(true);
        if (!copied.ok) throw new Error(copied.message);
        primaryMuscles.push('biceps');
        secondaryMuscles.push('shoulders');
        expect(copied.fields.strategy?.primaryMuscles).toEqual(['chest']);
        expect(copied.fields.strategy?.secondaryMuscles).toEqual(['back']);

        const maintenance = prepareCycleSubmission({
            ...validInput,
            strategyIntent: 'maintenance',
            progressionFocus: 'volume',
        });
        expect(maintenance.ok).toBe(true);
        if (!maintenance.ok) throw new Error(maintenance.message);
        expect(maintenance.fields.strategy).toEqual({ intent: 'maintenance' });
    });
});
