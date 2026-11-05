import { dispatchDurableOperation } from '../../lib/sync/dispatchDurableOperation';
import { useMemo, useRef, useState } from 'react';
import { shiftDateString } from '../../lib/utils/date';
import { useAppStore } from '../../store/useAppStore';
import { useSupplements } from '../../hooks/useSupplements';
import { Logic } from '../../lib/logic';
import { ContextMenu } from '../UI/ContextMenu';
import { Pencil, Copy, Trash2 } from 'lucide-react';
import { useDialogStore } from '../../store/useDialogStore';
import { captureSession, isCurrentSession } from '../../lib/sync/session';
import { NutritionDateNavigator } from './meals/NutritionDateNavigator';
import type { Supplement } from '../../types';

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
    const [suppForm, setSuppForm] = useState({ name: '', unit: 'g', target: '', portion: '' });
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

    const handlePrevDay = () => {
        if (!setSelectedDate || !targetDateStr) return;
        setSelectedDate(shiftDateString(targetDateStr, -1));
    };

    const handleNextDay = () => {
        if (!setSelectedDate || !targetDateStr) return;
        const today = Logic.getLocalDateString();
        if (targetDateStr === today) return;
        setSelectedDate(shiftDateString(targetDateStr, 1));
    };

    const handleToday = () => {
        if (setSelectedDate) setSelectedDate(Logic.getLocalDateString());
    };

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

    const handleEditSupplement = (supp: any) => {
        setEditingSuppId(supp.id);
        setSuppForm({
            name: supp.name,
            unit: supp.unit,
            target: supp.target ? supp.target.toString() : '',
            portion: supp.portion ? supp.portion.toString() : ''
        });
        setShowSuppModal(true);
    };

    const handleDuplicateSupplement = async (supp: any) => {
        const newName = Logic.generateUniqueName(supp.name, supplementsLibrary.map(s => s.name));
        const duplicated = {
            ...supp,
            id: Logic.generateId('supp'),
            name: newName
        };
        try {
            await dispatchDurableOperation(dispatchDomainOperation, { type: 'supplement.upsert', supplement: duplicated });
        } catch {
            await showAlert('Errore durante la duplicazione.');
        }
    };

    const handleDeleteSupplement = async (id: string, name: string) => {
        const confirmed = await showConfirm(`Sei sicuro di voler eliminare l'integratore "${name}" dalla libreria?`);
        if (confirmed) {
            await deleteSupplementFromLibrary(id);
        }
    };



    return (
        <div>
            {setSelectedDate && (
                <NutritionDateNavigator
                    targetDateStr={targetDateStr}
                    onPrevious={handlePrevDay}
                    onNext={handleNextDay}
                    onToday={handleToday}
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
                <div className="card mb-15" style={{ background: 'var(--surface-light)', border: '1px solid var(--primary-color)' }}>
                    <h2 className="mb-15" style={{color: 'var(--text-main)'}}>
                        {editingSuppId ? 'Modifica integratore' : 'Crea nuovo integratore'}
                    </h2>
                    
                    <div className="form-group">
                        <label htmlFor="supp-name">Nome integratore</label>
                        <input 
                            type="text" 
                            id="supp-name"
                                placeholder="es. Creatina, EAA, Caffeina" 
                            value={suppForm.name}
                                disabled={savingSupplement} 
                            onChange={e => setSuppForm({...suppForm, name: e.target.value})}
                            style={{ width: '100%', boxSizing: 'border-box' }}
                        />
                    </div>
                    
                    <div style={{ display: 'flex', gap: '15px' }}>
                        <div className="form-group" style={{ flex: 1, minWidth: 0 }}>
                            <label htmlFor="supp-target">Dose target giornaliera</label>
                            <input 
                                type="number" 
                                inputMode="decimal"
                                id="supp-target"
                                placeholder="Opzionale (es. 5)" 
                                value={suppForm.target}
                                disabled={savingSupplement} 
                                onChange={e => setSuppForm({...suppForm, target: e.target.value})}
                                style={{ width: '100%', boxSizing: 'border-box', appearance: 'none' }}
                            />
                        </div>
                        <div className="form-group" style={{ flex: 1, minWidth: 0 }}>
                            <label htmlFor="supp-portion">Dose singola (opzionale)</label>
                            <input 
                                type="number" 
                                inputMode="decimal"
                                id="supp-portion"
                                placeholder="es. 20" 
                                value={suppForm.portion}
                                disabled={savingSupplement} 
                                onChange={e => setSuppForm({...suppForm, portion: e.target.value})}
                                style={{ width: '100%', boxSizing: 'border-box', appearance: 'none' }}
                            />
                        </div>
                        <div className="form-group" style={{ flex: 1, minWidth: 0 }}>
                            <label htmlFor="supp-unit">Unità di misura</label>
                            <input 
                                type="text" 
                                id="supp-unit"
                                placeholder="es. g, mg, cp" 
                                value={suppForm.unit}
                                disabled={savingSupplement} 
                                onChange={e => setSuppForm({...suppForm, unit: e.target.value})}
                                style={{ width: '100%', boxSizing: 'border-box' }}
                            />
                        </div>
                    </div>

                    <div className="flex-between mt-20">
                        <button className="btn" onClick={() => {
                            setShowSuppModal(false);
                            setEditingSuppId(null);
                        }} disabled={savingSupplement}>Annulla</button>
                        <button className="btn btn-primary" onClick={() => { void handleSaveSupplement(); }} disabled={savingSupplement}>Salva</button>
                    </div>
                </div>
            )}

            {supplementsLibrary.length === 0 ? (
                <p className="text-muted text-center my-20">Non hai ancora aggiunto alcun integratore. Creane uno per iniziare a tracciarlo.</p>
            ) : (
                sortedSupplements.map((supp) => {
                    const suppIntakes = intakesBySupplement.get(supp.id) || [];
                    const totalAssunto = suppIntakes.reduce((acc, curr) => acc + curr.amount, 0);
                    const hasTarget = typeof supp.target === 'number' && Number.isFinite(supp.target) && supp.target > 0;
                    const progressPercent = hasTarget ? Math.min(Math.max((totalAssunto / supp.target!) * 100, 0), 100) : 0;
                    
                    return (
                        <div key={supp.id} className="card mb-15">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                <div>
                                    <div style={{ fontWeight: 'bold', fontSize: 'var(--font-size-control)', color: 'var(--text-main)' }}>{supp.name}</div>
                                    <div style={{ fontSize: 'var(--font-size-meta)', color: 'var(--text-muted)' }}>
                                        Assunto: <strong style={{ color: 'var(--text-main)' }}>{Math.round(totalAssunto * 10) / 10}</strong> {supp.unit} 
                                        {hasTarget ? ` / ${supp.target} ${supp.unit}` : ''}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '5px' }}>
                                    <ContextMenu
                                        items={[
                                            {
                                                label: 'Modifica',
                                                icon: <Pencil size={16} />,
                                                onClick: () => handleEditSupplement(supp)
                                            },
                                            {
                                                label: 'Duplica',
                                                icon: <Copy size={16} />,
                                                onClick: () => handleDuplicateSupplement(supp)
                                            },
                                            {
                                                label: 'Elimina',
                                                icon: <Trash2 size={16} />,
                                                variant: 'danger',
                                                onClick: () => handleDeleteSupplement(supp.id, supp.name)
                                            }
                                        ]}
                                    />
                                </div>
                            </div>

                            {hasTarget && (
                                <div className="progress-bg" style={{ height: '6px', marginBottom: '15px' }}>
                                    <div 
                                        className="progress-fill" 
                                        style={{ 
                                            width: `${progressPercent}%`, 
                                            background: progressPercent >= 100 ? 'var(--success-color)' : 'var(--primary-color)' 
                                        }}
                                    />
                                </div>
                            )}

                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '15px' }}>
                                <input 
                                    type="number" 
                                    inputMode="decimal"
                                    placeholder={`Quantità (${supp.unit})`}
                                    aria-label={`Quantità assunzione ${supp.name}`}
                                    value={quickInputs[supp.id] !== undefined ? quickInputs[supp.id] : (supp.portion ? String(supp.portion) : '')}
                                    onChange={e => setQuickInputs({ ...quickInputs, [supp.id]: e.target.value })}
                                    onFocus={e => e.target.select()}
                                    style={{ margin: 0, flex: 1, appearance: 'none', WebkitAppearance: 'none' }}
                                />
                                <button 
                                    className="btn btn-primary" 
                                    style={{ margin: 0, whiteSpace: 'nowrap', flex: 1 }}
                                    onClick={async () => {
                                        if (pendingIntakes.current.has(supp.id)) return;
                                        let valStr = quickInputs[supp.id];
                                        if (valStr === undefined) valStr = supp.portion ? String(supp.portion) : '';
                                        const amount = Number(valStr.trim().replace(',', '.'));
                                        if (!valStr.trim() || !Number.isFinite(amount) || amount <= 0) {
                                            await showAlert('Inserisci una quantità valida da assumere.');
                                            return;
                                        }
                                        pendingIntakes.current.add(supp.id);
                                        try {
                                            await addIntake(supp.id, amount);
                                            setQuickInputs(prev => {
                                                if (prev[supp.id] !== undefined && prev[supp.id] !== valStr) return prev;
                                                const next = { ...prev };
                                                delete next[supp.id];
                                                return next;
                                            });
                                        } catch {
                                            await showAlert("Errore durante l'aggiunta dell'assunzione.");
                                        } finally {
                                            pendingIntakes.current.delete(supp.id);
                                        }
                                    }}
                                >
                                    + Aggiungi
                                </button>
                            </div>

                            {suppIntakes.length > 0 && (
                                <div style={{ background: 'var(--surface-light)', borderRadius: '8px', padding: '10px' }}>
                                    <div style={{ fontSize: 'var(--font-size-meta)', color: 'var(--text-muted)', marginBottom: '8px' }}>Storico odierno:</div>
                                    {suppIntakes.map(intake => {
                                        const timeStr = new Date(intake.time).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
                                        return (
                                            <div key={intake.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px dashed var(--glass-border)' }}>
                                                <div style={{ fontSize: 'var(--font-size-body)' }}>
                                                    <span style={{ color: 'var(--text-muted)', marginRight: '8px' }}>{timeStr}</span>
                                                    <strong>{intake.amount}</strong> {supp.unit}
                                                </div>
                                                <button className="btn-icon text-danger" onClick={() => removeIntake(intake.id)}>✕</button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })
            )}
        </div>
    );
}


