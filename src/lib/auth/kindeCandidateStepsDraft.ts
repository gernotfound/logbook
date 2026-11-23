import type { NutritionDay } from '../../types';
import { captureActivitySteps } from '../activity';
import { openScopedDatedDraft } from '../sync/scopedDatedDraft';
import { getLocalDateString, parseDateInput } from '../utils/date';
import { z } from '../zod';
import type { KindeCatalogDraftController } from './kindeCandidateCatalogDraft';

const draftSchema = z.object({
    steps: z.string().max(32),
    basis: z.string().max(256),
    submitted: z.enum(['yes', 'no']),
}).strict();

export type KindeStepsDraft = {
    initial: { date: string; steps: string; submitted: boolean };
    write: (steps: string) => void;
    discard: () => void;
    close: () => void;
};

const stepsBasis = (day?: NutritionDay) => JSON.stringify(captureActivitySteps(day));

export async function openKindeCandidateStepsDraft({
    owner, revision, permitted, date, day,
}: {
    owner: string;
    revision: number;
    permitted: () => boolean;
    date: string;
    day?: NutritionDay;
}): Promise<KindeCatalogDraftController<KindeStepsDraft>> {
    if (parseDateInput(date) !== date || date > getLocalDateString()) throw new Error('Data attività non valida.');
    const draft = await openScopedDatedDraft({ name: 'draft:activity-steps:' + date, owner, revision, permitted });
    try {
        const initial = draftSchema.parse(draft.current() ?? {
            steps: day?.steps === undefined ? '' : String(day.steps),
            basis: stepsBasis(day), submitted: 'no',
        });
        const editable = () => {
            const current = draftSchema.parse(draft.current() ?? initial);
            if (current.submitted === 'yes') throw new Error('Salvataggio già tentato. Verifica l’archivio.');
            return current;
        };
        return {
            handle: {
                initial: { date, steps: initial.steps, submitted: initial.submitted === 'yes' },
                write: steps => draft.replace(draftSchema.parse({ ...editable(), steps })),
                discard: draft.discard,
                close: draft.close,
            },
            prepare: () => {
                const submitted = editable();
                const steps = Number(submitted.steps);
                if (!submitted.steps.trim() || !Number.isSafeInteger(steps) || steps < 0) {
                    throw new Error('Inserisci un numero intero di passi uguale o maggiore di zero.');
                }
                return {
                    operation: { type: 'activity-steps.set', date, steps, source: 'manual', capturedAt: Date.now() },
                    beforeCommit: envelope => {
                        if (envelope?.owner !== owner || envelope.consentRevision !== revision) return false;
                        if (stepsBasis(envelope.data.nutrition?.[date]) !== submitted.basis) {
                            throw new Error('I passi sono cambiati: bozza cifrata conservata.');
                        }
                        if (JSON.stringify(editable()) !== JSON.stringify(submitted)) return false;
                        draft.replace({ ...submitted, submitted: 'yes' });
                        return true;
                    },
                    clearAfterCommit: draft.discard,
                };
            },
        };
    } catch (error) {
        draft.close();
        throw error;
    }
}
