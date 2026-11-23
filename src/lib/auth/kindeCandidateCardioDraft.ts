import type { CardioSession, NutritionDay } from '../../types';
import { cardioDraftKind } from '../activity';
import { cardioDraftFromSession, EMPTY_CARDIO_DRAFT, prepareCardioSessionFields, type CardioDraftValues } from '../activityCardioForm';
import { isValidBusinessId } from '../businessIdentity';
import { openScopedDatedDraft } from '../sync/scopedDatedDraft';
import { generateId, getLocalDateString, parseDateInput } from '../utils/date';
import { z } from '../zod';
import type { KindeCatalogDraftController } from './kindeCandidateCatalogDraft';

const draftSchema = z.object({
    basis: z.string(),
    submitted: z.enum(['yes', 'no']),
    modality: z.string(),
    durationMinutes: z.string(),
    intensity: z.string(),
    structure: z.string(),
    averageHeartRate: z.string(),
    distanceKm: z.string(),
    notes: z.string(),
    startTime: z.string(),
}).strict();

export type KindeCardioDraft = {
    initial: { date: string; sessionId: string | null; values: CardioDraftValues; submitted: boolean };
    write: (values: CardioDraftValues) => void;
    discard: () => void;
    close: () => void;
};

export async function openKindeCandidateCardioDraft({
    owner, revision, permitted, date, sessionId, day,
}: {
    owner: string;
    revision: number;
    permitted: () => boolean;
    date: string;
    sessionId: string | null;
    day?: NutritionDay;
}): Promise<KindeCatalogDraftController<KindeCardioDraft>> {
    if (parseDateInput(date) !== date || date > getLocalDateString()) throw new Error('Data attività non valida.');
    if (sessionId !== null && !isValidBusinessId(sessionId)) throw new Error('Sessione cardio non valida.');
    const fromDay = (source?: NutritionDay) => source?.cardioSessions?.find(session => session.id === sessionId);
    const existing = fromDay(day);
    if (sessionId !== null && !existing) throw new Error('Sessione cardio non disponibile per questo giorno.');

    const draft = await openScopedDatedDraft({
        name: 'draft:' + cardioDraftKind(sessionId, sessionId === null) + ':' + date,
        owner, revision, permitted,
    });
    try {
        const initial = draftSchema.parse(draft.current() ?? {
            ...(existing ? cardioDraftFromSession(existing) : EMPTY_CARDIO_DRAFT),
            basis: JSON.stringify(existing ?? null), submitted: 'no',
        });
        const editable = () => {
            const current = draftSchema.parse(draft.current() ?? initial);
            if (current.submitted === 'yes') throw new Error('Salvataggio già tentato. Verifica l’archivio.');
            return current;
        };
        const { basis: _basis, submitted, ...values } = initial;
        return {
            handle: {
                initial: { date, sessionId, values, submitted: submitted === 'yes' },
                write: values => {
                    const current = editable();
                    draft.replace(draftSchema.parse({ ...values, basis: current.basis, submitted: current.submitted }));
                },
                discard: draft.discard,
                close: draft.close,
            },
            prepare: () => {
                const current = editable();
                const prepared = prepareCardioSessionFields(current, date, existing);
                if (!prepared.ok) throw new Error(prepared.message);
                const session: CardioSession = { id: sessionId ?? generateId('cardio'), ...prepared.fields };
                return {
                    operation: { type: 'cardio-session.upsert', date, session },
                    beforeCommit: envelope => {
                        if (envelope?.owner !== owner || envelope.consentRevision !== revision) return false;
                        const latestDay = envelope.data.nutrition?.[date];
                        if (JSON.stringify(fromDay(latestDay) ?? null) !== current.basis
                            || (sessionId === null && latestDay?.cardioSessions?.some(item => item.id === session.id))) {
                            throw new Error('Sessione cardio cambiata: bozza cifrata conservata.');
                        }
                        if (JSON.stringify(editable()) !== JSON.stringify(current)) return false;
                        draft.replace({ ...current, submitted: 'yes' });
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
