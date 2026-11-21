import { describe, expect, it } from 'vitest';
import { localDateTimeToTimestamp } from '../../../src/lib/activity';
import {
    EMPTY_CARDIO_DRAFT,
    cardioDraftFromSession,
    prepareCardioSessionFields,
    type CardioDraftValues,
} from '../../../src/lib/activityCardioForm';
import type { CardioSession } from '../../../src/types';

const date = '2026-09-24';
const form: CardioDraftValues = {
    ...EMPTY_CARDIO_DRAFT,
    modality: 'bike',
    intensity: 'moderate',
    durationMinutes: '40',
};

describe('activity cardio form model', () => {
    it('prepares canonical decimals with local-day timing, without allocating an ID', () => {
        const input = { ...form, distanceKm: ' 2,50 ', startTime: '18:30' };
        const original = { ...input };
        const result = prepareCardioSessionFields(input, date);
        expect(result).toEqual({
            ok: true,
            fields: {
                modality: 'bike',
                intensity: 'moderate',
                durationMinutes: 40,
                distanceKm: 2.5,
                startedAt: localDateTimeToTimestamp(date, '18:30'),
                source: 'manual',
            },
        });
        expect(input).toEqual(original);
        if (result.ok) expect('id' in result.fields).toBe(false);
    });

    it('round-trips the editable fields and preserves imported source identity metadata', () => {
        const existing: CardioSession = {
            id: 'cardio-imported', modality: 'run', intensity: 'high',
            structure: 'intervals', durationMinutes: 25, averageHeartRate: 151,
            distanceKm: 3.2, notes: 'recorded', source: 'imported',
            externalId: 'sensor-event-1', startedAt: localDateTimeToTimestamp(date, '07:30'),
        };
        const draft = cardioDraftFromSession(existing);
        expect(draft).toEqual({
            modality: 'run', intensity: 'high', structure: 'intervals',
            durationMinutes: '25', averageHeartRate: '151',
            distanceKm: '3.2', notes: 'recorded', startTime: '07:30',
        });
        expect(prepareCardioSessionFields({ ...draft, notes: ' adjusted ' }, date, existing)).toEqual({
            ok: true,
            fields: {
                modality: 'run', intensity: 'high', structure: 'intervals',
                durationMinutes: 25, averageHeartRate: 151,
                distanceKm: 3.2, notes: 'adjusted', source: 'imported',
                externalId: 'sensor-event-1', startedAt: existing.startedAt,
            },
        });
        expect(existing.id).toBe('cardio-imported');
    });

    it.each([
        [{ ...form, modality: '' }, 'Seleziona modalità e intensità del cardio.'],
        [{ ...form, modality: 'unknown' }, 'Seleziona modalità e intensità del cardio.'],
        [{ ...form, intensity: 'other' }, 'Seleziona modalità e intensità del cardio.'],
        [{ ...form, durationMinutes: '' }, 'Inserisci una durata valida in minuti.'],
        [{ ...form, durationMinutes: '0' }, 'Inserisci una durata valida in minuti.'],
        [{ ...form, durationMinutes: '1441' }, 'Inserisci una durata valida in minuti.'],
        [{ ...form, durationMinutes: '1,5' }, 'Inserisci una durata valida in minuti.'],
        [{ ...form, durationMinutes: '0x28' }, 'Inserisci una durata valida in minuti.'],
        [{ ...form, averageHeartRate: '301' }, 'Inserisci una frequenza cardiaca media valida.'],
        [{ ...form, averageHeartRate: '0x78' }, 'Inserisci una frequenza cardiaca media valida.'],
        [{ ...form, distanceKm: '-1' }, 'Inserisci una distanza valida.'],
        [{ ...form, distanceKm: '0x10' }, 'Inserisci una distanza valida.'],
        [{ ...form, distanceKm: '0b11' }, 'Inserisci una distanza valida.'],
        [{ ...form, distanceKm: '1,2,3' }, 'Inserisci una distanza valida.'],
        [{ ...form, structure: 'unknown' }, 'Seleziona una struttura cardio valida.'],
        [{ ...form, startTime: '25:00' }, 'Inserisci un orario di inizio valido.'],
        [{ ...form, startTime: '02:70' }, 'Inserisci un orario di inizio valido.'],
    ] as const)('rejects invalid form data before constructing an operation: %o', (values, message) => {
        expect(prepareCardioSessionFields(values, date)).toEqual({ ok: false, message });
    });

    it('keeps optional fields absent without inventing 0 or metadata', () => {
        const result = prepareCardioSessionFields(form, date);
        expect(result).toEqual({
            ok: true,
            fields: {
                modality: 'bike', durationMinutes: 40, intensity: 'moderate', source: 'manual',
            },
        });
    });

    it('preserves valid decimal exponent syntax already accepted by HTML number inputs', () => {
        const result = prepareCardioSessionFields({
            ...form,
            durationMinutes: '4e1',
            averageHeartRate: '+120',
            distanceKm: '.75',
        }, date);
        expect(result).toEqual({
            ok: true,
            fields: {
                modality: 'bike', intensity: 'moderate', durationMinutes: 40,
                averageHeartRate: 120, distanceKm: 0.75, source: 'manual',
            },
        });
    });
});
