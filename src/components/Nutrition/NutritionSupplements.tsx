import { dispatchDurableOperation } from '../../lib/sync/dispatchDurableOperation';
import { useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useSupplements } from '../../hooks/useSupplements';
import { Logic } from '../../lib/logic';
import { useDialogStore } from '../../store/useDialogStore';
import { captureSession, isCurrentSession } from '../../lib/sync/session';
import { NutritionDateNavigator } from './meals/NutritionDateNavigator';
import type { Supplement } from '../../types';
import { SupplementEditorForm, type SupplementEditorFormValues } from './SupplementEditorForm';
import { SupplementCard } from './SupplementCard';

interface NutritionSupplementsProps {
    selectedDate?: string;
    setSelectedDate?: (d: string) => void;
}

export default function NutritionSupplements({ selectedDate, setSelectedDate }: NutritionSupplementsProps) {
    const dispatchDomainOperation = useAppStore(s => s.dispatchDomainOperation);
    const { 
        targetDateStr, supplementsLibrary, supplementsIntake, 
        saveSupplementToLibrary, deleteSupplementFromLibrary, 
        addIntake, removeIntake 
    } = useSupplements(selectedDate);
    
    const showConfirm = useDialogStore(s => s.showConfirm);
    const showAlert = useDialogStore(s => s.showAlert);
    
    // Stato per la modale di creazione/modifica integratore
    const [showSuppModal, setShowSuppModal] = useState(false);
    const [editingSuppId, setEditingSuppId] = useState<string | null>(null);
    const [suppForm, setSuppForm] = useState<SupplementEditorFormValues>({ name: '', unit: 'g', target: '', portion: '' });
    const [savingSupplement, setSavingSupplement] = useState(false);
    const savingSupplementRef = useRef(false);
    const pendingIntakes = useRef(new Set<string>());

    // Stato per gli input inline di assunzione rapida
    const [quickInputs, setQuickInputs] = useState<Record<string, string>>({});
    const sortedSupplements = useMemo(
        () => [...supplementsLibrary].sort((a, b) => a.name.localeCompare(b.name)),
        [supplementsLibrary]
    );
    const intakesBySupplement = useMemo(() => {
        const grouped = new Map<string, typeof supplementsIntake>();
        for (const intake of supplementsIntake) {
            const list = grouped.get(intake.supplementId);
            if (list) list.push(intake);
            else grouped.set(intake.supplementId, [intake]);
        }
        return grouped;
    }, [supplementsIntake]);

    const parseOptionalDose = (raw: string): number | null | undefined => {
        if (!raw.trim()) return undefined;
        const value = Number(raw.trim().replace(',', '.'));
        return Number.isFinite(value) && value > 0 ? value : null;
    };

    const handleSaveSupplement = async () => {
        if (savingSupplementRef.current) return;
        if (!suppForm.name.trim() || !suppForm.unit.trim()) {
            await showAlert("Inserisci il nome e l'unità dell'integratore.");
            return;
        }
        const target = parseOptionalDose(suppForm.target);
        const portion = parseOptionalDose(suppForm.portion);
        if (target === null || portion === null) {
            await showAlert('Le dosi devono essere numeri positivi validi.');
            return;
        }
        const payload: Omit<Supplement, 'id'> = {
            name: suppForm.name.trim(),
            unit: suppForm.unit.trim(),
            ...(target !== undefined ? { target } : {}),
            ...(portion !== undefined ? { portion } : {}),
        };
        const session = captureSession();
        savingSupplementRef.current = true;
        setSavingSupplement(true);
        try {
            await saveSupplementToLibrary(payload, editingSuppId || undefined);
            if (!isCurrentSession(session)) return;
            setShowSuppModal(false);
            setEditingSuppId(null);
            setSuppForm({ name: '', unit: 'g', target: '', portion: '' });
        } catch {
            if (isCurrentSession(session)) await showAlert("Errore durante il salvataggio dell'integratore.");
        } finally {
            savingSupplementRef.current = false;
            setSavingSupplement(false);
        }
    };

    const handleEditSupplement = (supp: Supplement) => {
        setEditingSuppId(supp.id);
        setSuppForm({
            name: supp.name,
            unit: supp.unit,
            target: supp.target ? supp.target.toString() : '',
            portion: supp.portion ? supp.portion.toString() : ''
        });
        setShowSuppModal(true);
    };

    const handleDuplicateSupplement = async (supp: Supplement) => {
        const session = captureSession();
        const newName = Logic.generateUniqueName(supp.name, supplementsLibrary.map(s => s.name));
        const duplicated = {
            ...supp,
            id: Logic.generateId('supp'),
            name: newName
        };
        try {
            await dispatchDurableOperation(dispatchDomainOperation, { type: 'supplement.upsert', supplement: duplicated });
        } catch {
            if (isCurrentSession(session)) await showAlert('Errore durante la duplicazione.');
        }
    };

    const handleDeleteSupplement = async (id: string, name: string) => {
        const session = captureSession();
        const confirmed = await showConfirm(`Sei sicuro di voler eliminare l'integratore "${name}" dalla libreria?`);
        // A confirmation belongs to the original Auth epoch, not to a reused supplement ID.
        if (confirmed && isCurrentSession(session)) {
            await deleteSupplementFromLibrary(id);
        }
    };


    const handleAddIntake = async (supp: Supplement) => {
        if (pendingIntakes.current.has(supp.id)) return;
        let entered = quickInputs[supp.id];
        if (entered === undefined) entered = supp.portion ? String(supp.portion) : '';
        const amount = Number(entered.trim().replace(',', '.'));
        if (!entered.trim() || !Number.isFinite(amount) || amount <= 0) {
            await showAlert('Inserisci una quantità valida da assumere.');
            return;
        }

        const session = captureSession();
        pendingIntakes.current.add(supp.id);
        try {
            await addIntake(supp.id, amount);
            if (isCurrentSession(session)) {
                setQuickInputs(previous => {
                    if (previous[supp.id] !== undefined && previous[supp.id] !== entered) return previous;
                    const next = { ...previous };
                    delete next[supp.id];
                    return next;
                });
            }
        } catch {
            if (isCurrentSession(session)) await showAlert("Errore durante l'aggiunta dell'assunzione.");
        } finally {
            pendingIntakes.current.delete(supp.id);
        }
    };

    return (
        <div>
            {setSelectedDate && (
                <NutritionDateNavigator
                    targetDateStr={targetDateStr}
                    setSelectedDate={setSelectedDate}
                />
            )}

            {!showSuppModal ? (
                <button 
                    className="btn btn-primary" 
                    style={{ width: '100%', marginBottom: '15px' }}
                    onClick={() => {
                        setEditingSuppId(null);
                        setSuppForm({ name: '', unit: 'g', target: '', portion: '' });
                        setShowSuppModal(true);
                    }}
                >
                    + Nuovo integratore
                </button>
            ) : (
                <SupplementEditorForm
                    editing={editingSuppId !== null}
                    form={suppForm}
                    disabled={savingSupplement}
                    onChange={(field, value) => setSuppForm(previous => ({ ...previous, [field]: value }))}
                    onCancel={() => {
                        setShowSuppModal(false);
                        setEditingSuppId(null);
                    }}
                    onSave={() => { void handleSaveSupplement(); }}
                />
            )}

            {supplementsLibrary.length === 0 ? (
                <p className="text-muted text-center my-20">Non hai ancora aggiunto alcun integratore. Creane uno per iniziare a tracciarlo.</p>
            ) : (
                sortedSupplements.map(supp => (
                    <SupplementCard
                        key={supp.id}
                        supplement={supp}
                        intakes={intakesBySupplement.get(supp.id) ?? []}
                        quickInput={quickInputs[supp.id]}
                        onQuickInputChange={value => setQuickInputs(previous => ({ ...previous, [supp.id]: value }))}
                        onEdit={() => handleEditSupplement(supp)}
                        onDuplicate={() => handleDuplicateSupplement(supp)}
                        onDelete={() => handleDeleteSupplement(supp.id, supp.name)}
                        onAddIntake={() => handleAddIntake(supp)}
                        onRemoveIntake={removeIntake}
                    />
                ))
            )}
        </div>
    );
}


