import { useMemo, useRef, useState } from 'react';
import { useDatedDraft } from './useDatedDraft';
import { useLocalToday } from './useLocalToday';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { captureSession, isCurrentSession } from '../lib/sync/session';
import { Logic } from '../lib/logic';
import { localDateTimeToTimestamp, timestampToLocalTime } from '../lib/activity';
import { computeWeeklyActivitySeries } from '../lib/calc/analytics';
import type { CardioSession } from '../types';

const EMPTY_NUTRITION = {};
const EMPTY_CARDIO_DRAFT = {
    modality: '',
    durationMinutes: '',
    intensity: '',
    structure: '',
    averageHeartRate: '',
    distanceKm: '',
    notes: '',
    startTime: '',
};

export function useActivityTracking() {
    const nutrition = useAppStore(state => state.userData?.nutrition || EMPTY_NUTRITION);
    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);
    const showAlert = useDialogStore(state => state.showAlert);
    const showConfirm = useDialogStore(state => state.showConfirm);
    const today = useLocalToday();
    const [chosenDate, setChosenDate] = useState<string | null>(null);
    const selectedDate = chosenDate ?? today;
    const setSelectedDate = (date: string) => setChosenDate(date === today ? null : date);
    const day = (nutrition as any)[selectedDate];
    const stepsDraft = useDatedDraft('activity-steps', selectedDate, {
        steps: day?.steps !== undefined ? String(day.steps) : '',
    });
    const [editingCardioId, setEditingCardioId] = useState<string | null>(null);
    const editingCardio = editingCardioId && editingCardioId !== 'new'
        ? (day?.cardioSessions ?? []).find((item: CardioSession) => item.id === editingCardioId)
        : undefined;
    const cardioSource = editingCardio ? {
        modality: editingCardio.modality,
        durationMinutes: String(editingCardio.durationMinutes),
        intensity: editingCardio.intensity ?? '',
        structure: editingCardio.structure ?? '',
        averageHeartRate: editingCardio.averageHeartRate !== undefined ? String(editingCardio.averageHeartRate) : '',
        distanceKm: editingCardio.distanceKm !== undefined ? String(editingCardio.distanceKm) : '',
        notes: editingCardio.notes ?? '',
        startTime: timestampToLocalTime(editingCardio.startedAt),
    } : EMPTY_CARDIO_DRAFT;
    const cardioDraft = useDatedDraft(`activity-cardio-${editingCardioId ?? 'idle'}`, selectedDate, cardioSource);
    const savingSteps = useRef(false);
    const savingCardio = useRef(false);

    const cardioSessions = useMemo(() => {
        const values = Array.isArray(day?.cardioSessions) ? [...day.cardioSessions] as CardioSession[] : [];
        return values.sort((a, b) => (a.startedAt ?? Number.MAX_SAFE_INTEGER) - (b.startedAt ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id));
    }, [day]);

    const currentWeek = useMemo(() => {
        const result = computeWeeklyActivitySeries(nutrition as any, 1, today);
        return result.points[0];
    }, [nutrition, today]);

    const saveSteps = async () => {
        if (savingSteps.current) return false;
        const raw = stepsDraft.values.steps.trim();
        const steps = Number(raw);
        if (!raw || !Number.isFinite(steps) || !Number.isInteger(steps) || steps < 0) {
            await showAlert('Inserisci un numero intero di passi uguale o maggiore di zero.');
            return false;
        }
        savingSteps.current = true;
        const session = captureSession();
        const submitted = { ...stepsDraft.values };
        try {
            if (!isCurrentSession(session)) throw new Error('Sessione cambiata');
            await dispatchDomainOperation({ type: 'activity-steps.set', date: selectedDate, steps, source: 'manual', capturedAt: Date.now() });
            if (!isCurrentSession(session)) return false;
            return stepsDraft.clear(submitted);
        } catch {
            if (isCurrentSession(session)) await showAlert('Errore durante il salvataggio dei passi.');
            return false;
        } finally {
            savingSteps.current = false;
        }
    };

    const clearSteps = async () => {
        const session = captureSession();
        if (!(await showConfirm('Rimuovere i passi registrati per questo giorno?')) || !isCurrentSession(session)) return false;
        try {
            await dispatchDomainOperation({ type: 'activity-steps.clear', date: selectedDate });
            if (!isCurrentSession(session)) return false;
            try { stepsDraft.clear(); } catch { /* Il dato business è già stato salvato. */ }
            return true;
        } catch {
            if (isCurrentSession(session)) await showAlert('Errore durante la rimozione dei passi.');
            return false;
        }
    };

    const startNewCardio = () => setEditingCardioId('new');
    const editCardio = (id: string) => setEditingCardioId(id);
    const cancelCardio = () => {
        try { cardioDraft.clear(); } catch { /* L'errore bozza è già visibile nello stato sync. */ }
        setEditingCardioId(null);
    };

    const saveCardio = async () => {
        if (savingCardio.current) return false;
        const form = cardioDraft.values;
        const durationMinutes = Number(form.durationMinutes);
        const averageHeartRate = form.averageHeartRate.trim() === '' ? undefined : Number(form.averageHeartRate);
        const distanceKm = form.distanceKm.trim() === '' ? undefined : Number(form.distanceKm.replace(',', '.'));
        if (!form.modality || !form.intensity) {
            await showAlert('Seleziona modalità e intensità del cardio.');
            return false;
        }
        if (!Number.isFinite(durationMinutes) || !Number.isInteger(durationMinutes) || durationMinutes <= 0 || durationMinutes > 1440) {
            await showAlert('Inserisci una durata valida in minuti.');
            return false;
        }
        if (averageHeartRate !== undefined && (!Number.isFinite(averageHeartRate) || !Number.isInteger(averageHeartRate) || averageHeartRate <= 0 || averageHeartRate > 300)) {
            await showAlert('Inserisci una frequenza cardiaca media valida.');
            return false;
        }
        if (distanceKm !== undefined && (!Number.isFinite(distanceKm) || distanceKm < 0)) {
            await showAlert('Inserisci una distanza valida.');
            return false;
        }
        const startedAt = form.startTime ? localDateTimeToTimestamp(selectedDate, form.startTime) : undefined;
        if (form.startTime && startedAt === undefined) {
            await showAlert('Inserisci un orario di inizio valido.');
            return false;
        }
        const existing = editingCardio;
        const cardioSession: CardioSession = {
            id: existing?.id ?? Logic.generateId('cardio'),
            modality: form.modality as CardioSession['modality'],
            durationMinutes,
            intensity: form.intensity as NonNullable<CardioSession['intensity']>,
            source: existing?.source ?? 'manual',
        };
        if (form.structure) cardioSession.structure = form.structure as NonNullable<CardioSession['structure']>;
        if (averageHeartRate !== undefined) cardioSession.averageHeartRate = averageHeartRate;
        if (distanceKm !== undefined) cardioSession.distanceKm = distanceKm;
        if (form.notes.trim()) cardioSession.notes = form.notes.trim();
        if (startedAt !== undefined) cardioSession.startedAt = startedAt;
        if (existing?.externalId) cardioSession.externalId = existing.externalId;

        savingCardio.current = true;
        const session = captureSession();
        const submitted = { ...form };
        try {
            if (!isCurrentSession(session)) throw new Error('Sessione cambiata');
            await dispatchDomainOperation({ type: 'cardio-session.upsert', date: selectedDate, session: cardioSession });
            if (!isCurrentSession(session)) return false;
            const cleared = cardioDraft.clear(submitted);
            if (cleared) setEditingCardioId(null);
            return cleared;
        } catch {
            if (isCurrentSession(session)) await showAlert('Errore durante il salvataggio della sessione cardio.');
            return false;
        } finally {
            savingCardio.current = false;
        }
    };

    const deleteCardio = async (id: string) => {
        const session = captureSession();
        if (!(await showConfirm('Eliminare questa sessione cardio?')) || !isCurrentSession(session)) return false;
        try {
            await dispatchDomainOperation({ type: 'cardio-session.delete', date: selectedDate, sessionId: id });
            if (!isCurrentSession(session)) return false;
            if (editingCardioId === id) setEditingCardioId(null);
            return true;
        } catch {
            if (isCurrentSession(session)) await showAlert('Errore durante l’eliminazione della sessione cardio.');
            return false;
        }
    };

    return {
        today,
        selectedDate,
        setSelectedDate,
        steps: stepsDraft.values.steps,
        setSteps: (value: string) => stepsDraft.setField('steps', value),
        savedSteps: day?.steps as number | undefined,
        saveSteps,
        clearSteps,
        cardioSessions,
        editingCardioId,
        cardioForm: cardioDraft.values,
        setCardioField: <K extends keyof typeof cardioDraft.values>(field: K, value: (typeof cardioDraft.values)[K]) => cardioDraft.setField(field, value),
        startNewCardio,
        editCardio,
        cancelCardio,
        saveCardio,
        deleteCardio,
        currentWeek,
    };
}
