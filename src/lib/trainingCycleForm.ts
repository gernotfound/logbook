import { addDays, differenceInCalendarDays, parseISO, format, isValid, startOfDay } from 'date-fns';
import { MAX_EDITABLE_CYCLE_WEEKS, MAX_CYCLE_SESSIONS_PER_WEEK } from './calc/cycleLimits';
import { formatItalianDate, getLocalDateString, parseDateInput } from './utils/date';
import type {
    TrainingCycle,
    TrainingCycleIntent,
    TrainingCycleProgressionFocus,
    TrainingCycleRoutineItem,
    TrainingCycleStrategy,
} from '../types';

export function computeEndDate(startIso: string, weeks: number): string {
    try {
        const parsed = typeof startIso === 'string' && !startIso.includes('T') ? parseISO(startIso) : new Date(startIso);
        if (!isValid(parsed)) return startIso;
        const totalWeeks = Math.min(MAX_EDITABLE_CYCLE_WEEKS, Math.max(1, weeks));
        const end = addDays(startOfDay(parsed), totalWeeks * 7 - 1);
        return format(end, 'yyyy-MM-dd');
    } catch {
        return startIso;
    }
}

export function computeWeeksFromDates(startIso: string, endIso: string): number {
    try {
        const start = typeof startIso === 'string' && !startIso.includes('T') ? parseISO(startIso) : new Date(startIso);
        const end = typeof endIso === 'string' && !endIso.includes('T') ? parseISO(endIso) : new Date(endIso);
        if (!isValid(start) || !isValid(end)) return 1;
        const diffDays = differenceInCalendarDays(startOfDay(end), startOfDay(start));
        if (diffDays < 0) return 1;
        return Math.max(1, Math.ceil((diffDays + 1) / 7));
    } catch {
        return 1;
    }
}

export interface CycleFormSubmissionInput {
    name: string;
    cycleRoutines: TrainingCycleRoutineItem[];
    strategyIntent: TrainingCycleIntent | '';
    progressionFocus: TrainingCycleProgressionFocus | '';
    durationWeeks: string;
    sessionsPerWeek: string;
    dateTextInput: string;
    endDateTextInput: string;
    notes: string;
    primaryMuscles: string[];
    secondaryMuscles: string[];
}

export type CycleEditorDraft = CycleFormSubmissionInput & { startDate: string; endDate: string };

export function initialCycleForm(cycle?: TrainingCycle | null): CycleEditorDraft {
    const startDate = cycle?.startDate || getLocalDateString();
    const durationWeeks = cycle?.durationWeeks ?? 6;
    const endDate = cycle?.endDate || computeEndDate(startDate, durationWeeks);
    return {
        name: cycle?.name ?? '',
        cycleRoutines: structuredClone(cycle?.routines ?? []),
        strategyIntent: cycle?.strategy?.intent ?? '',
        progressionFocus: cycle?.strategy?.progressionFocus ?? '',
        durationWeeks: String(durationWeeks),
        sessionsPerWeek: String(cycle?.sessionsPerWeek ?? (cycle?.routines?.length || 4)),
        startDate, endDate,
        dateTextInput: formatItalianDate(startDate),
        endDateTextInput: formatItalianDate(endDate),
        notes: cycle?.notes ?? '',
        primaryMuscles: [...(cycle?.strategy?.primaryMuscles ?? [])],
        secondaryMuscles: [...(cycle?.strategy?.secondaryMuscles ?? [])],
    };
}

type EditableCycleFields = Pick<
    TrainingCycle,
    'name' | 'durationWeeks' | 'sessionsPerWeek' | 'startDate' | 'endDate' | 'notes' | 'strategy' | 'routines'
>;

export type PreparedCycleSubmission =
    | { ok: true; fields: EditableCycleFields }
    | { ok: false; message: string };

// The form's user-editable validation belongs to this model. The hook owns
// only UI state and the durable-save callback; identity is allocated after validation.
export function prepareCycleSubmission(input: CycleFormSubmissionInput): PreparedCycleSubmission {
    const {
        name, cycleRoutines, strategyIntent, progressionFocus, durationWeeks,
        sessionsPerWeek, dateTextInput, endDateTextInput, notes,
        primaryMuscles, secondaryMuscles,
    } = input;
    const trimmedName = name.trim();
    if (!trimmedName) {
        return { ok: false, message: 'Inserisci un nome per il ciclo di allenamento.' };
    }
    if (cycleRoutines.length === 0) {
        return { ok: false, message: 'Aggiungi almeno una scheda al ciclo di allenamento.' };
    }
    if (strategyIntent === 'development' && !progressionFocus) {
        return { ok: false, message: 'Seleziona cosa vuoi far progredire principalmente.' };
    }

    // Preserve editor semantics: nonpositive integers snap to the minimum,
    // but positive out-of-range values and fractions are rejected.
    const rawWeeks = durationWeeks.trim() === '' ? 4 : Number(durationWeeks);
    const rawFreq = sessionsPerWeek.trim() === '' ? cycleRoutines.length : Number(sessionsPerWeek);
    const weeks = Math.max(1, rawWeeks);
    const freqPerWeek = Math.max(1, rawFreq);
    if (!Number.isSafeInteger(weeks) || weeks > MAX_EDITABLE_CYCLE_WEEKS
        || !Number.isSafeInteger(freqPerWeek) || freqPerWeek > MAX_CYCLE_SESSIONS_PER_WEEK) {
        return {
            ok: false,
            message: 'Il ciclo deve durare da 1 a 52 settimane e prevedere da 1 a 14 sedute intere a settimana.',
        };
    }

    // Do not persist a previously valid calendar date when the current
    // text is invalid. An inverted interval is not a valid cycle.
    const validStartDate = parseDateInput(dateTextInput);
    const validEndDate = parseDateInput(endDateTextInput);
    if (!validStartDate || !validEndDate || validEndDate < validStartDate) {
        return {
            ok: false,
            message: 'Inserisci date di inizio e fine valide, con la fine non precedente all’inizio.',
        };
    }

    // Only blank/nonpositive weeks override the edited end date.
    const savedEndDate = durationWeeks.trim() === '' || rawWeeks < 1
        ? computeEndDate(validStartDate, weeks)
        : validEndDate;
    const hasStrategyDetails = Boolean(strategyIntent || primaryMuscles.length || secondaryMuscles.length);
    const strategy: TrainingCycleStrategy | undefined = hasStrategyDetails
        ? {
            ...(strategyIntent ? { intent: strategyIntent } : {}),
            ...(strategyIntent === 'development' && progressionFocus ? { progressionFocus } : {}),
            ...(primaryMuscles.length ? { primaryMuscles: [...primaryMuscles] } : {}),
            ...(secondaryMuscles.length ? { secondaryMuscles: [...secondaryMuscles] } : {}),
        }
        : undefined;

    return {
        ok: true,
        fields: {
            name: trimmedName,
            durationWeeks: weeks,
            sessionsPerWeek: freqPerWeek,
            startDate: validStartDate,
            endDate: savedEndDate,
            notes: notes.trim(),
            ...(strategy ? { strategy } : {}),
            routines: cycleRoutines,
        },
    };
}
