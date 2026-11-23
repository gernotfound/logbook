import { Logic } from '../logic';
import { prepareSleepPatch, sleepDraftFromDay, type SleepDraftValues } from '../sleepForm';
import type { NutritionDay } from '../../types';
import type { DomainOperation } from '../sync/domainOperations';
import { z } from '../zod';
import { openKindeCatalogDraft, type KindeCatalogDraftController } from './kindeCandidateCatalogDraft';

const SLEEP_FIELDS = ['sleepHours', 'sleepDeep', 'sleepLight', 'sleepRem', 'sleepAwake'] as const;
const valuesSchema = z.object({
    sleepHours: z.string().max(16),
    sleepDeep: z.string().max(16),
    sleepLight: z.string().max(16),
    sleepRem: z.string().max(16),
    sleepAwake: z.string().max(16),
}).strict();
const draftSchema = z.object({
    version: z.literal(1),
    date: z.string().refine(value => Logic.parseDateInput(value) === value),
    basis: z.string().max(2048),
    hasExisting: z.boolean(),
    values: valuesSchema,
    submitted: z.boolean(),
}).strict();

type StoredSleepDraft = z.infer<typeof draftSchema>;

export type KindeSleepDraft = {
    initial: { date: string; hasExisting: boolean; values: SleepDraftValues; submitted: boolean };
    write: (values: SleepDraftValues) => void;
    discard: () => void;
    close: () => void;
};

const basisForDay = (day?: NutritionDay): string => JSON.stringify(Object.fromEntries(
    SLEEP_FIELDS.filter(field => day && Object.hasOwn(day, field))
        .map(field => [field, day?.[field]]),
));

const hasSleep = (day?: NutritionDay): boolean => SLEEP_FIELDS.some(field =>
    day?.[field] !== undefined && day?.[field] !== null && day?.[field] !== ''
);

export async function openKindeCandidateSleepDraft({
    owner, revision, permitted, date, day,
}: {
    owner: string;
    revision: number;
    permitted: () => boolean;
    date: string;
    day?: NutritionDay;
}): Promise<KindeCatalogDraftController<KindeSleepDraft>> {
    if (Logic.parseDateInput(date) !== date || date > Logic.getLocalDateString()) {
        throw new Error('Data del sonno non valida.');
    }
    const device = await openKindeCatalogDraft<StoredSleepDraft>({
        owner, key: 'draft_sleep', revision, permitted,
        parse: value => draftSchema.parse(value),
        initialize: () => ({
            version: 1, date, basis: basisForDay(day),
            hasExisting: hasSleep(day), values: sleepDraftFromDay(day), submitted: false,
        }),
    });
    try {
        const stored = device.current();
        // A recovered draft belongs to its original day. Changing the picker
        // cannot silently relabel the retained user intent.
        return {
            handle: {
                initial: {
                    date: stored.date, hasExisting: stored.hasExisting,
                    values: structuredClone(stored.values), submitted: stored.submitted,
                },
                write: values => device.persist({ ...device.editable(), values }),
                discard: device.discard, close: device.close,
            },
            prepare: () => {
                const submitted = device.editable();
                const prepared = prepareSleepPatch(submitted.values);
                if (!prepared.ok) throw new Error(prepared.message);
                const operation: DomainOperation = {
                    type: 'nutrition-day.patch', date: submitted.date, patch: prepared.patch,
                };
                return device.prepareCommit(submitted, operation, envelope => {
                    // Do not turn a stale editor into an overwrite. Only sleep
                    // fields are fenced: concurrent meals, measurements and
                    // activity must remain independently writable.
                    if (basisForDay(envelope.data.nutrition?.[submitted.date]) !== submitted.basis) {
                        throw new Error('Il sonno è cambiato: bozza cifrata conservata.');
                    }
                });
            },
        };
    } catch (error) {
        device.close();
        throw error;
    }
}
