import { useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { useLocalToday } from './useLocalToday';
import { Logic } from '../lib/logic';
import type { ContextEvent, ContextEventType } from '../types';

const EMPTY_NUTRITION = {};

export const CONTEXT_EVENT_TYPES: ReadonlyArray<{ value: ContextEventType; label: string }> = [
    { value: 'training', label: 'Allenamento' },
    { value: 'nutrition', label: 'Nutrizione' },
    { value: 'recovery', label: 'Recupero' },
    { value: 'schedule', label: 'Programmazione' },
    { value: 'travel', label: 'Viaggio' },
    { value: 'reentry', label: 'Rientro / riacclimatazione' },
    { value: 'deload', label: 'Deload' },
    { value: 'other', label: 'Altro' },
];

export function contextEventTypeLabel(type: ContextEventType): string {
    return CONTEXT_EVENT_TYPES.find(item => item.value === type)?.label ?? 'Altro';
}

export function useContextTimeline() {
    const nutrition = useAppStore(state => state.userData?.nutrition || EMPTY_NUTRITION);
    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);
    const showAlert = useDialogStore(state => state.showAlert);
    const showConfirm = useDialogStore(state => state.showConfirm);
    const today = useLocalToday();
    const [chosenDate, setChosenDate] = useState<string | null>(null);
    const selectedDate = chosenDate ?? today;
    const setSelectedDate = (date: string) => setChosenDate(date === today ? null : date);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [type, setType] = useState<ContextEventType>('training');
    const [label, setLabel] = useState('');
    const [note, setNote] = useState('');

    const eventsForSelectedDate = useMemo(() => {
        const events = Array.isArray((nutrition as any)[selectedDate]?.contextEvents)
            ? ([...(nutrition as any)[selectedDate].contextEvents] as ContextEvent[])
            : [];
        return events.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || a.id.localeCompare(b.id));
    }, [nutrition, selectedDate]);

    const recentEvents = useMemo(() => {
        const result: Array<{ date: string; event: ContextEvent }> = [];
        for (const [date, rawDay] of Object.entries(nutrition as Record<string, any>)) {
            const events = Array.isArray(rawDay?.contextEvents) ? rawDay.contextEvents as ContextEvent[] : [];
            events.forEach(event => result.push({ date, event }));
        }
        return result
            .sort((a, b) => b.date.localeCompare(a.date) || (b.event.createdAt ?? 0) - (a.event.createdAt ?? 0))
            .slice(0, 40);
    }, [nutrition]);

    const resetForm = () => {
        setEditingId(null);
        setType('training');
        setLabel('');
        setNote('');
    };

    const startEdit = (event: ContextEvent) => {
        setEditingId(event.id);
        setType(event.type);
        setLabel(event.label);
        setNote(event.note ?? '');
    };

    const saveEvent = async () => {
        const normalizedLabel = label.trim();
        if (!normalizedLabel) {
            await showAlert('Inserisci una descrizione per il contesto.');
            return false;
        }
        const existing = editingId ? eventsForSelectedDate.find(event => event.id === editingId) : undefined;
        if (editingId && !existing) {
            resetForm();
            await showAlert('L’evento che stavi modificando non è più disponibile in questo giorno.');
            return false;
        }
        const event: ContextEvent = {
            id: existing?.id ?? Logic.generateId('ctx'),
            type,
            label: normalizedLabel,
            ...(note.trim() ? { note: note.trim() } : {}),
            createdAt: existing?.createdAt ?? Date.now(),
        };
        try {
            await dispatchDomainOperation({ type: 'context-event.upsert', date: selectedDate, event });
            resetForm();
            return true;
        } catch {
            await showAlert('Errore durante il salvataggio del contesto.');
            return false;
        }
    };

    const deleteEvent = async (id: string) => {
        if (!(await showConfirm('Eliminare questo evento di contesto?'))) return false;
        try {
            await dispatchDomainOperation({ type: 'context-event.delete', date: selectedDate, eventId: id });
            if (editingId === id) resetForm();
            return true;
        } catch {
            await showAlert('Errore durante l’eliminazione del contesto.');
            return false;
        }
    };

    return {
        today,
        selectedDate,
        setSelectedDate,
        eventsForSelectedDate,
        recentEvents,
        editingId,
        type,
        setType,
        label,
        setLabel,
        note,
        setNote,
        resetForm,
        startEdit,
        saveEvent,
        deleteEvent,
    };
}
