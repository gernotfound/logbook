import { Logic } from '../logic';
import { captureMeasurement } from '../nutrition/measurementHistory';
import { hasMeasurementData } from '../nutrition/measurementPresence';
import { parseMeasurementNumber, prepareBodyMeasurements, type BodyMeasurementDraft } from '../nutrition/measurementInput';
import { z } from '../zod';
import type { BodyFatProvenance, NutritionDay, UserProfile } from '../../types';
import type { DomainOperation } from '../sync/domainOperations';
import { openKindeCatalogDraft, type KindeCatalogDraftController } from './kindeCandidateCatalogDraft';

export type KindeMeasurementValues = BodyMeasurementDraft & {
    measureTime: string;
    calculateBf: boolean;
};

const valueSchema = z.object({
    weight: z.string().max(80), waist: z.string().max(80), neck: z.string().max(80),
    hip: z.string().max(80), chest: z.string().max(80), shoulders: z.string().max(80),
    biceps: z.string().max(80), thighs: z.string().max(80), calves: z.string().max(80),
    measureTime: z.string().max(16), calculateBf: z.boolean(),
}).strict();

const draftSchema = z.object({
    version: z.literal(1),
    date: z.string().refine(value => Logic.parseDateInput(value) === value),
    basis: z.string().max(8192),
    profileBasis: z.string().max(2048),
    hasExisting: z.boolean(),
    values: valueSchema,
    submitted: z.boolean(),
}).strict();

type RecordDraft = z.infer<typeof draftSchema>;

export type KindeMeasurementDraft = {
    initial: { date: string; hasExisting: boolean; values: KindeMeasurementValues; submitted: boolean };
    write: (values: KindeMeasurementValues) => void;
    discard: () => void;
    close: () => void;
};

const basisForDay = (day?: NutritionDay): string => JSON.stringify(day ? captureMeasurement(day) : {});
const basisForProfile = (profile?: UserProfile): string =>
    JSON.stringify({ gender: profile?.gender ?? null, height: profile?.height ?? null });

const dayValue = (value: unknown): string => value == null ? '' : String(value);

function initialValues(day?: NutritionDay): KindeMeasurementValues {
    return {
        weight: dayValue(day?.weight),
        waist: dayValue(day?.waist), neck: dayValue(day?.neck), hip: dayValue(day?.hip),
        chest: dayValue(day?.chest), shoulders: dayValue(day?.shoulders),
        biceps: dayValue(day?.biceps), thighs: dayValue(day?.thighs), calves: dayValue(day?.calves),
        measureTime: day?.measurementTime || new Date().toTimeString().slice(0, 5),
        calculateBf: day?.bfProvenance?.method === 'us_navy',
    };
}

function measurementPatch(values: KindeMeasurementValues, profile?: UserProfile) {
    const prepared = prepareBodyMeasurements(values);
    if (!prepared.ok) {
        throw new Error(prepared.reason === 'weight'
            ? 'Inserisci un valore valido per il peso.'
            : 'Inserisci misure numeriche valide.');
    }
    if (values.measureTime !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(values.measureTime)) {
        throw new Error('Orario della misurazione non valido.');
    }
    const measures = prepared.values;
    let bf: number | undefined;
    let bfProvenance: BodyFatProvenance | undefined;
    if (values.calculateBf) {
        const gender = profile?.gender;
        const height = parseMeasurementNumber(profile?.height);
        if ((gender !== 'M' && gender !== 'F') || height === null || height <= 0) {
            throw new Error('Imposta sesso e altezza nella sezione Biometria.');
        }
        if (!measures.waist || !measures.neck || (gender === 'F' && !measures.hip)) {
            throw new Error('Inserisci le circonferenze richieste per il metodo US Navy.');
        }
        const result = Logic.calculateBodyFatByMethod(gender === 'F' ? 'navy_female' : 'navy_male', {
            gender, height, waist: measures.waist, neck: measures.neck,
            hip: gender === 'F' ? measures.hip : undefined,
        });
        if (result === null || !Number.isFinite(result)) {
            throw new Error('Impossibile calcolare la massa grassa con le misure inserite.');
        }
        bf = Math.round(result * 10) / 10;
        bfProvenance = {
            method: 'us_navy',
            inputs: {
                heightCm: height, waistCm: measures.waist, neckCm: measures.neck,
                ...(gender === 'F' ? { hipCm: measures.hip } : {}), gender,
            },
        };
    }
    return {
        ...measures,
        hip: profile?.gender === 'F' ? measures.hip : undefined,
        bf, bfProvenance, measurementTime: values.measureTime,
    };
}

export async function openKindeCandidateMeasurementDraft({
    owner, revision, permitted, date, day, profile,
}: {
    owner: string;
    revision: number;
    permitted: () => boolean;
    date: string;
    day?: NutritionDay;
    profile?: UserProfile;
}): Promise<KindeCatalogDraftController<KindeMeasurementDraft>> {
    if (Logic.parseDateInput(date) !== date || date > Logic.getLocalDateString()) {
        throw new Error('Data di misurazione non valida.');
    }
    const device = await openKindeCatalogDraft<RecordDraft>({
        owner, key: 'draft_measurement', revision, permitted,
        parse: value => draftSchema.parse(value),
        initialize: () => ({
            version: 1, date, basis: basisForDay(day), profileBasis: basisForProfile(profile),
            hasExisting: hasMeasurementData(day), values: initialValues(day), submitted: false,
        }),
    });
    try {
        const stored = device.current();
        // A recovered draft owns its original day: a newer date selection must
        // never silently retag it or overwrite the only device recovery copy.
        return {
            handle: {
                initial: {
                    date: stored.date, hasExisting: stored.hasExisting,
                    values: structuredClone(stored.values), submitted: stored.submitted,
                },
                write: values => device.persist({ ...device.editable(), values }),
                discard: device.discard, close: device.close,
            },
            prepare: ({ profile: latestProfile }) => {
                const submitted = device.editable();
                const patch = measurementPatch(submitted.values, latestProfile);
                const operation: DomainOperation = {
                    type: 'nutrition-day.patch', date: submitted.date, patch,
                };
                return device.prepareCommit(submitted, operation, envelope => {
                    if (basisForDay(envelope.data.nutrition?.[submitted.date]) !== submitted.basis) {
                        throw new Error('La misurazione è cambiata: bozza conservata.');
                    }
                    if (submitted.values.calculateBf
                        && basisForProfile(envelope.data.profile) !== submitted.profileBasis) {
                        throw new Error('Il profilo biometrico è cambiato: bozza conservata.');
                    }
                });
            },
        };
    } catch (error) {
        device.close();
        throw error;
    }
}
