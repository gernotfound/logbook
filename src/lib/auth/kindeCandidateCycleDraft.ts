import equal from 'fast-deep-equal';
import type { TrainingCycle } from '../../types';
import { TrainingCycleRoutineItemSchema, TrainingCycleSchema } from '../schemas/schema_training';
import { requiredUpdateRecoveryRegistry } from '../sync/requiredUpdateRecovery';
import { initialCycleForm, prepareCycleSubmission, type CycleEditorDraft } from '../trainingCycleForm';
import { generateId } from '../utils/date';
import { draftRegistry } from '../utils/draftRegistry';
import { z } from '../zod';
import { openKindeCatalogDraft, type KindeCatalogDraftController } from './kindeCandidateCatalogDraft';

const formSchema = z.object({
    name: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    dateTextInput: z.string(),
    endDateTextInput: z.string(),
    durationWeeks: z.string(),
    sessionsPerWeek: z.string(),
    notes: z.string(),
    strategyIntent: z.enum(['', 'development', 'maintenance', 'deload']),
    progressionFocus: z.enum(['', 'performance', 'volume', 'density', 'execution']),
    primaryMuscles: z.array(z.string()),
    secondaryMuscles: z.array(z.string()),
    cycleRoutines: z.array(TrainingCycleRoutineItemSchema),
}).strict();

const recordSchema = z.object({
    version: z.literal(1),
    submitted: z.boolean(),
    expected: TrainingCycleSchema.nullable(),
    values: formSchema,
}).strict();

type StoredCycleDraft = {
    version: 1;
    submitted: boolean;
    expected: TrainingCycle | null;
    values: CycleEditorDraft;
};

export type KindeCycleDraft = {
    initial: { cycle: TrainingCycle | null; values: CycleEditorDraft; submitted: boolean; stale: boolean };
    write: (values: CycleEditorDraft) => void;
    discard: () => void;
    close: () => void;
};

export async function openKindeCandidateCycleDraft({
    owner, revision, permitted, cycleId, cycles,
}: {
    owner: string;
    revision: number;
    permitted: () => boolean;
    cycleId?: string;
    cycles: TrainingCycle[];
}): Promise<KindeCatalogDraftController<KindeCycleDraft>> {
    const requested = cycles.find(item => item.id === cycleId);
    const device = await openKindeCatalogDraft<StoredCycleDraft>({
        owner, revision, permitted, key: 'draft_training_cycle',
        parse: value => recordSchema.parse(value),
        initialize: () => {
            if (cycleId !== undefined && !requested) throw new Error('Ciclo non disponibile.');
            return recordSchema.parse({
                version: 1, expected: requested ?? null, values: initialCycleForm(requested), submitted: false,
            });
        },
    });
    try {
        const initial = device.current();
        if (cycleId !== undefined && initial.expected?.id !== cycleId) {
            throw new Error('Riprendi prima la bozza del ciclo già presente.');
        }
        const existing = cycles.find(item => item.id === initial.expected?.id);
        const stale = !equal(existing ?? null, initial.expected);
        const editable = () => {
            if (stale) throw new Error('Il ciclo originale è cambiato. La bozza cifrata è conservata.');
            return device.editable();
        };
        const verify = () => { device.current(); };
        draftRegistry.register(verify);
        const unregisterRecovery = requiredUpdateRecoveryRegistry.register(verify);
        const close = () => {
            draftRegistry.unregister(verify);
            unregisterRecovery();
            device.close();
        };
        const discard = () => { device.discard(); close(); };
        return {
            handle: {
                initial: {
                    cycle: structuredClone(initial.expected), values: structuredClone(initial.values),
                    submitted: initial.submitted, stale,
                },
                write: values => device.persist({ ...editable(), values }),
                discard,
                close,
            },
            prepare: () => {
                const submitted = editable();
                const prepared = prepareCycleSubmission(submitted.values);
                if (!prepared.ok) throw new Error(prepared.message);
                const expected = submitted.expected;
                const preparedCommit = device.prepareCommit(submitted, {
                    type: 'training-cycle.upsert', expected,
                    cycle: {
                        ...prepared.fields,
                        id: expected?.id ?? generateId('cycle'),
                        createdAt: expected?.createdAt ?? Date.now(),
                        progressionMode: expected?.progressionMode ?? 'sequential',
                        isActive: expected?.isActive ?? false,
                    },
                });
                return { ...preparedCommit, clearAfterCommit: discard };
            },
        };
    } catch (error) {
        device.close();
        throw error;
    }
}
