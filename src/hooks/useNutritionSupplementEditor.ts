import { useMemo, useRef, useState } from 'react';
import type { SupplementEditorFormValues } from '../components/Nutrition/SupplementEditorForm';
import type { createSupplementActions } from '../lib/nutrition/supplementActions';
import { generateUniqueName } from '../lib/utils/string';
import { useDialogStore } from '../store/useDialogStore';
import type { Supplement, SupplementIntake } from '../types';
import type { CaptureNutritionSession } from './useNutritionMealEditor';

const EMPTY_FORM: SupplementEditorFormValues = { name: '', unit: 'g', target: '', portion: '' };

function parseOptionalDose(raw: string): number | null | undefined {
    if (!raw.trim()) return undefined;
    const value = Number(raw.trim().replace(',', '.'));
    return Number.isFinite(value) && value > 0 ? value : null;
}

export function useNutritionSupplementEditor({
    library, intakes, actions, capture,
}: {
    library: Supplement[];
    intakes: SupplementIntake[];
    actions: ReturnType<typeof createSupplementActions>;
    capture: CaptureNutritionSession;
}) {
    const { saveSupplementToLibrary, deleteSupplementFromLibrary, addIntake, removeIntake } = actions;
    const showConfirm = useDialogStore(state => state.showConfirm);
    const showAlert = useDialogStore(state => state.showAlert);
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const pendingIntakes = useRef(new Set<string>());
    const [quickInputs, setQuickInputs] = useState<Record<string, string>>({});

    const sortedSupplements = useMemo(
        () => [...library].sort((a, b) => a.name.localeCompare(b.name)),
        [library],
    );
    const intakesBySupplement = useMemo(() => {
        const grouped = new Map<string, SupplementIntake[]>();
        for (const intake of intakes) {
            const list = grouped.get(intake.supplementId);
            if (list) list.push(intake);
            else grouped.set(intake.supplementId, [intake]);
        }
        return grouped;
    }, [intakes]);

    const openForm = (supplement?: Supplement) => {
        setEditingId(supplement?.id ?? null);
        setForm(supplement ? {
            name: supplement.name,
            unit: supplement.unit,
            target: supplement.target?.toString() ?? '',
            portion: supplement.portion?.toString() ?? '',
        } : EMPTY_FORM);
        setShowForm(true);
    };
    const closeForm = () => {
        setShowForm(false);
        setEditingId(null);
    };
    const save = async () => {
        if (savingRef.current) return;
        const session = capture();
        if (!session?.isCurrent()) return;
        const name = form.name.trim();
        const unit = form.unit.trim();
        if (!name || !unit) {
            await showAlert("Inserisci il nome e l'unità dell'integratore.");
            return;
        }
        const target = parseOptionalDose(form.target);
        const portion = parseOptionalDose(form.portion);
        if (target === null || portion === null) {
            await showAlert('Le dosi devono essere numeri positivi validi.');
            return;
        }
        savingRef.current = true;
        setSaving(true);
        try {
            await saveSupplementToLibrary({ name, unit,
                ...(target !== undefined ? { target } : {}),
                ...(portion !== undefined ? { portion } : {}),
            }, editingId ?? undefined);
            if (session.isCurrent()) {
                closeForm();
                setForm(EMPTY_FORM);
            }
        } catch {
            if (session.isCurrent()) await showAlert("Errore durante il salvataggio dell'integratore.");
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };
    const duplicate = async (supplement: Supplement) => {
        const session = capture();
        if (!session?.isCurrent()) return;
        const name = generateUniqueName(supplement.name, library.map(item => item.name));
        try {
            await saveSupplementToLibrary({ ...supplement, name });
        } catch {
            if (session.isCurrent()) await showAlert('Errore durante la duplicazione.');
        }
    };
    const removeSupplement = async (id: string) => {
        const session = capture();
        if (!session?.isCurrent()) return;
        // The global dialog can outlive the archive view.
        const confirmed = await showConfirm("Eliminare questo integratore dalla libreria?");
        if (confirmed && session.isCurrent()) await deleteSupplementFromLibrary(id);
    };
    const recordIntake = async (supplement: Supplement) => {
        const { id, portion } = supplement;
        if (pendingIntakes.current.has(id)) return;
        const session = capture();
        if (!session?.isCurrent()) return;
        const entered = quickInputs[id] ?? portion?.toString() ?? '';
        const amount = parseOptionalDose(entered);
        if (amount == null) {
            await showAlert('Inserisci una quantità valida da assumere.');
            return;
        }
        pendingIntakes.current.add(id);
        try {
            await addIntake(id, amount);
            if (session.isCurrent()) setQuickInputs(previous => {
                if (previous[id] !== undefined && previous[id] !== entered) return previous;
                const next = { ...previous };
                delete next[id];
                return next;
            });
        } catch {
            if (session.isCurrent()) await showAlert("Errore durante l'aggiunta dell'assunzione.");
        } finally {
            pendingIntakes.current.delete(id);
        }
    };
    return {
        showForm, editing: editingId !== null, form, saving, sortedSupplements, intakesBySupplement, quickInputs,
        openForm, closeForm, save, duplicate, removeSupplement, recordIntake, removeIntake,
        changeForm: (field: keyof SupplementEditorFormValues, value: string) =>
            setForm(previous => ({ ...previous, [field]: value })),
        changeQuickInput: (id: string, value: string) => setQuickInputs(previous => ({ ...previous, [id]: value })),
    };
}
