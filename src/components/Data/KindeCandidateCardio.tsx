import { useRef, useState } from 'react';
import type { useKindeCandidateFitnessLifecycle } from '../../contexts/auth/useKindeCandidateFitnessLifecycle';
import { ActivityCardioSection, type ActivityCardioProps } from './activity/ActivityCardioSection';
import type { ActivityEditorAccess } from './KindeCandidateActivity';
import { EMPTY_CARDIO_DRAFT, prepareCardioSessionFields } from '../../lib/activityCardioForm';
import type { KindeCardioDraft } from '../../lib/auth/kindeCandidateCardioDraft';
import { useDialogStore } from '../../store/useDialogStore';
import type { CardioSession } from '../../types';

type Realm = ReturnType<typeof useKindeCandidateFitnessLifecycle>;
type Editor = { draft: KindeCardioDraft; isCurrent: () => boolean };

export function KindeCandidateCardio({ realm, date, sessions, access }: {
    realm: Realm;
    date: string;
    sessions?: CardioSession[];
    access: ActivityEditorAccess;
}) {
    const [editor, setEditor] = useState<Editor | null>(null);
    const [values, setValues] = useState(EMPTY_CARDIO_DRAFT);
    const currentValues = useRef(values);
    const [opening, setOpening] = useState(false);
    const [blocked, setBlocked] = useState(false);
    const showAlert = useDialogStore(state => state.showAlert);
    const showConfirm = useDialogStore(state => state.showConfirm);
    const displayed = [...(sessions ?? [])].sort((a, b) =>
        (a.startedAt ?? Number.MAX_SAFE_INTEGER) - (b.startedAt ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id));

    let status: string | null = null;
    if (editor?.draft.initial.submitted) status = 'Salvataggio già tentato. Verifica l’archivio prima di eliminare la bozza.';
    else if (editor?.draft.initial.stale) status = 'La sessione originale è cambiata o è stata eliminata. La bozza resta disponibile per la verifica.';
    else if (blocked) status = 'Bozza da verificare. Chiudi e riapri il giorno per rileggere la copia cifrata.';

    const open = async (id: string | null) => {
        const witness = realm.captureEditWitness();
        if (!witness?.isCurrent() || !access.claim()) return;
        setOpening(true);
        let opened = false;
        try {
            const draft = await realm.openCardioDraft(date, id);
            if (!witness.isCurrent()) { draft.close(); return; }
            setEditor({ draft, isCurrent: witness.isCurrent });
            currentValues.current = draft.initial.values;
            setValues(draft.initial.values);
            setBlocked(false);
            opened = true;
        } catch {
            if (witness.isCurrent()) await showAlert('Impossibile aprire la sessione. Usa “Aggiungi o riprendi cardio” per verificare la bozza del giorno.');
        } finally {
            setOpening(false);
            if (!opened) access.release();
        }
    };
    const setCardioField: ActivityCardioProps['setCardioField'] = (field, value) => {
        if (!editor?.isCurrent() || status) return;
        const next = { ...currentValues.current, [field]: value };
        try {
            editor.draft.write(next);
            currentValues.current = next;
            setValues(next);
        } catch { setBlocked(true); }
    };
    const close = () => {
        editor?.draft.close();
        setEditor(null);
        access.release();
        return true;
    };
    const discard = async () => {
        if (!editor?.isCurrent()) return;
        try {
            if (!(await showConfirm('Eliminare la bozza cardio da questo dispositivo?')) || !editor.isCurrent()) return;
            editor.draft.discard();
            close();
        } catch {
            if (editor.isCurrent()) await showAlert('Impossibile eliminare la bozza. Copia conservata.');
        }
    };
    const save = async () => {
        if (!editor?.isCurrent() || status) return false;
        const prepared = prepareCardioSessionFields(currentValues.current, date);
        if (!prepared.ok) { await showAlert(prepared.message); return false; }
        try {
            const saved = await realm.saveCardioDraft(editor.draft);
            if (!saved.draftCleared && editor.isCurrent()) {
                await showAlert('Sessione salvata. Verifica la copia di recupero sul dispositivo.');
            }
            return close();
        } catch {
            if (editor.isCurrent()) await showAlert('Impossibile salvare il cardio. La bozza cifrata resta sul dispositivo.');
            return false;
        }
    };
    const remove = async (id: string) => {
        const witness = realm.captureEditWitness();
        const expected = displayed.find(item => item.id === id);
        if (!expected || !witness?.isCurrent() || !access.claim()) return false;
        try {
            if (!(await showConfirm('Eliminare questa sessione cardio?')) || !witness.isCurrent()) return false;
            await realm.submit({ type: 'cardio-session.delete', date, sessionId: id, expected });
            return true;
        } catch {
            if (witness.isCurrent()) await showAlert('Impossibile rimuovere la sessione cardio. Verifica il dato corrente.');
            return false;
        } finally { access.release(); }
    };

    return <ActivityCardioSection disabled={access.disabled || opening} accountDraft={{ status, discard }} activity={{
        cardioForm: values,
        cardioSessions: displayed,
        editingCardioId: editor ? editor.draft.initial.sessionId ?? '/new' : null,
        isCreatingCardio: editor?.draft.initial.sessionId === null,
        startNewCardio: () => { void open(null); },
        editCardio: id => { void open(id); },
        deleteCardio: remove,
        setCardioField,
        cancelCardio: close,
        saveCardio: save,
    }} />;
}
