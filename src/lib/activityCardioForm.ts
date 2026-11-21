import type { CardioSession } from '../types';
import {
    CARDIO_INTENSITIES,
    CARDIO_MODALITIES,
    CARDIO_STRUCTURES,
    localDateTimeToTimestamp,
    timestampToLocalTime,
} from './activity';

export interface CardioDraftValues extends Record<string, string> {
    modality: string;
    durationMinutes: string;
    intensity: string;
    structure: string;
    averageHeartRate: string;
    distanceKm: string;
    notes: string;
    startTime: string;
}

export const EMPTY_CARDIO_DRAFT: CardioDraftValues = {
    modality: '',
    durationMinutes: '',
    intensity: '',
    structure: '',
    averageHeartRate: '',
    distanceKm: '',
    notes: '',
    startTime: '',
};

export function cardioDraftFromSession(session: CardioSession): CardioDraftValues {
    return {
        modality: session.modality,
        durationMinutes: String(session.durationMinutes),
        intensity: session.intensity ?? '',
        structure: session.structure ?? '',
        averageHeartRate: session.averageHeartRate !== undefined ? String(session.averageHeartRate) : '',
        distanceKm: session.distanceKm !== undefined ? String(session.distanceKm) : '',
        notes: session.notes ?? '',
        startTime: timestampToLocalTime(session.startedAt),
    };
}

type PreparedCardioSession =
    | { ok: true; fields: Omit<CardioSession, 'id'> }
    | { ok: false; message: string };

// Number() accepts hex, binary and other non-decimal inputs that the UI's
// kilometre field does not describe. Preserve decimal/exponent input semantics.
const DECIMAL_LITERAL = /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?$/;

function decimalInput(value: string): number {
    const trimmed = value.trim();
    return DECIMAL_LITERAL.test(trimmed) ? Number(trimmed.replace(',', '.')) : Number.NaN;
}

/**
 * Interpret a staged user form without assigning an identity or committing it.
 * The caller retains the owner/session/draft checks and durable Domain Operation.
 */
export function prepareCardioSessionFields(
    form: CardioDraftValues,
    date: string,
    existing?: CardioSession,
): PreparedCardioSession {
    if (!CARDIO_MODALITIES.some(item => item.value === form.modality)
        || !CARDIO_INTENSITIES.some(item => item.value === form.intensity)) {
        return { ok: false, message: 'Seleziona modalità e intensità del cardio.' };
    }
    const durationMinutes = decimalInput(form.durationMinutes);
    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0 || durationMinutes > 1440) {
        return { ok: false, message: 'Inserisci una durata valida in minuti.' };
    }

    const averageHeartRate = form.averageHeartRate.trim()
        ? decimalInput(form.averageHeartRate) : undefined;
    if (averageHeartRate !== undefined
        && (!Number.isInteger(averageHeartRate) || averageHeartRate <= 0 || averageHeartRate > 300)) {
        return { ok: false, message: 'Inserisci una frequenza cardiaca media valida.' };
    }

    const distanceKm = form.distanceKm.trim()
        ? decimalInput(form.distanceKm) : undefined;
    if (distanceKm !== undefined && (!Number.isFinite(distanceKm) || distanceKm < 0)) {
        return { ok: false, message: 'Inserisci una distanza valida.' };
    }

    if (form.structure && !CARDIO_STRUCTURES.some(item => item.value === form.structure)) {
        return { ok: false, message: 'Seleziona una struttura cardio valida.' };
    }
    const startedAt = form.startTime ? localDateTimeToTimestamp(date, form.startTime) : undefined;
    if (form.startTime && startedAt === undefined) {
        return { ok: false, message: 'Inserisci un orario di inizio valido.' };
    }

    const fields: Omit<CardioSession, 'id'> = {
        modality: form.modality as CardioSession['modality'],
        durationMinutes,
        intensity: form.intensity as NonNullable<CardioSession['intensity']>,
        source: existing?.source ?? 'manual',
    };
    if (form.structure) fields.structure = form.structure as NonNullable<CardioSession['structure']>;
    if (averageHeartRate !== undefined) fields.averageHeartRate = averageHeartRate;
    if (distanceKm !== undefined) fields.distanceKm = distanceKm;
    if (form.notes.trim()) fields.notes = form.notes.trim();
    if (startedAt !== undefined) fields.startedAt = startedAt;
    if (existing?.externalId) fields.externalId = existing.externalId;
    return { ok: true, fields };
}
