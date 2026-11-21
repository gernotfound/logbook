import type { NutritionDay } from '../types';
import { formatSleepTime, parseSleepInput } from './utils/date';

export interface SleepDraftValues extends Record<string, string> {
    sleepHours: string;
    sleepDeep: string;
    sleepLight: string;
    sleepRem: string;
    sleepAwake: string;
}

type SleepPatch = Pick<NutritionDay, 'sleepHours' | 'sleepDeep' | 'sleepLight' | 'sleepRem' | 'sleepAwake'>;
type SleepPreparation = { ok: true; patch: SleepPatch } | { ok: false; message: string };

const OPTIONAL_PHASES = [
    ['sleepDeep', 'Il formato del sonno profondo non è valido (HH:MM).'],
    ['sleepLight', 'Il formato del sonno leggero non è valido (HH:MM).'],
    ['sleepRem', 'Il formato del sonno REM non è valido (HH:MM).'],
    ['sleepAwake', 'Il formato del tempo sveglio non è valido (HH:MM).'],
] as const;

export function sleepDraftFromDay(day?: SleepPatch): SleepDraftValues {
    return {
        sleepHours: formatSleepTime(day?.sleepHours),
        sleepDeep: formatSleepTime(day?.sleepDeep),
        sleepLight: formatSleepTime(day?.sleepLight),
        sleepRem: formatSleepTime(day?.sleepRem),
        sleepAwake: formatSleepTime(day?.sleepAwake),
    };
}

/**
 * Prepare a patch without mutating the draft or touching storage. Explicit
 * undefined phase fields are required: clearing an input must clear the
 * corresponding previously recorded phase through nutrition-day.patch.
 */
export function prepareSleepPatch(form: SleepDraftValues): SleepPreparation {
    const sleepHours = parseSleepInput(form.sleepHours);
    if (!sleepHours) {
        return { ok: false, message: 'Le ore di sonno sono obbligatorie e devono essere in un formato valido (HH:MM).' };
    }

    const patch: SleepPatch = {
        sleepHours,
        sleepDeep: undefined,
        sleepLight: undefined,
        sleepRem: undefined,
        sleepAwake: undefined,
    };

    for (const [field, message] of OPTIONAL_PHASES) {
        const raw = form[field];
        if (!raw) continue;
        const parsed = parseSleepInput(raw);
        if (parsed === null) return { ok: false, message };
        patch[field] = parsed;
    }

    return { ok: true, patch };
}
