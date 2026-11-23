import type { CardioSession, NutritionDay } from '../../types';
import { cardioDraftFromSession, EMPTY_CARDIO_DRAFT, prepareCardioSessionFields, type CardioDraftValues } from '../activityCardioForm';
import { isValidBusinessId } from '../businessIdentity';
import { openScopedDatedDraft } from '../sync/scopedDatedDraft';
import { generateId, getLocalDateString, parseDateInput } from '../utils/date';
import { z } from '../zod';
import type { KindeCatalogDraftController } from './kindeCandidateCatalogDraft';

const draftSchema = z.object({
    basis: z.string(),
    submitted: z.enum(['yes', 'no']),
    target: z.string().refine(value => value === '' || isValidBusinessId(value)),
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
    initial: { date: string; sessionId: string | null; values: CardioDraftValues; submitted: boolean; stale: boolean };
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
    const findInDay = (id: string | null, source?: NutritionDay) => source?.cardioSessions?.find(session => session.id === id);

    // One recoverable slot per day. The target is authenticated inside the
    // record, so a deleted session cannot hide its retained edit draft.
    const draft = await openScopedDatedDraft({
        name: 'draft:activity-cardio:' + date, owner, revision, permitted,
    });
    try {
        const recovered = draft.current();
        const requested = findInDay(sessionId, day);
        if (recovered === null && sessionId !== null && !requested) {
            throw new Error('Sessione cardio non disponibile per questo giorno.');
        }
        const initial = draftSchema.parse(recovered ?? {
            ...(requested ? cardioDraftFromSession(requested) : EMPTY_CARDIO_DRAFT),
            basis: JSON.stringify(requested ?? null), submitted: 'no', target: sessionId ?? '',
        });
        if (sessionId !== null && initial.target !== sessionId) {
            throw new Error('Riprendi prima la bozza cardio conservata per questo giorno.');
        }
        const target = initial.target || null;
        const existing = findInDay(target, day);
        const stale = JSON.stringify(existing ?? null) !== initial.basis;
        const editable = () => {
            const current = draftSchema.parse(draft.current() ?? initial);
            if (current.submitted === 'yes') throw new Error('Salvataggio già tentato. Verifica l’archivio.');
            if (stale) throw new Error('Sessione originale cambiata: bozza cifrata conservata.');
            return current;
        };
        const { basis: _basis, target: _target, submitted, ...values } = initial;
        return {
            handle: {
                initial: { date, sessionId: target, values, submitted: submitted === 'yes', stale },
                write: values => {
                    const current = editable();
                    draft.replace(draftSchema.parse({ ...values, basis: current.basis, submitted: current.submitted, target: current.target }));
                },
                discard: draft.discard,
                close: draft.close,
            },
            prepare: () => {
                const current = editable();
                const prepared = prepareCardioSessionFields(current, date, existing);
                if (!prepared.ok) throw new Error(prepared.message);
                const session: CardioSession = { id: target ?? generateId('cardio'), ...prepared.fields };
                return {
                    operation: { type: 'cardio-session.upsert', date, session },
                    beforeCommit: envelope => {
                        if (envelope?.owner !== owner || envelope.consentRevision !== revision) return false;
                        const latestDay = envelope.data.nutrition?.[date];
                        if (JSON.stringify(findInDay(target, latestDay) ?? null) !== current.basis
                            || (target === null && latestDay?.cardioSessions?.some(item => item.id === session.id))) {
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
