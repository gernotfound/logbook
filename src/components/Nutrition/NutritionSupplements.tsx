import { useState } from 'react';
import { shiftDateString } from '../../lib/utils/date';
import { useAppStore } from '../../store/useAppStore';
import { useSupplements } from '../../hooks/useSupplements';
import { Logic } from '../../lib/logic';
import { ContextMenu } from '../UI/ContextMenu';
import { Pencil, Copy, Trash2 } from 'lucide-react';
import { useDialogStore } from '../../store/useDialogStore';

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

    // Stato per gli input inline di assunzione rapida
    const [quickInputs, setQuickInputs] = useState<Record<string, string>>({});

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

    const handleSaveSupplement = async () => {
        if (!suppForm.name.trim()) {
            await showAlert("Inserisci il nome dell'integratore.");
            return;
        }
        
        const payload: any = {
            name: suppForm.name.trim(),
            unit: suppForm.unit
        };
        
        if (suppForm.target) {
            payload.target = parseFloat(suppForm.target);
        } else {
            payload.target = null;
        }
        if (suppForm.portion) {
            payload.portion = parseFloat(suppForm.portion);
        } else {
            payload.portion = null;
        }
        
        await saveSupplementToLibrary(payload, editingSuppId || undefined);
        
        setShowSuppModal(false);
        setEditingSuppId(null);
        setSuppForm({ name: '', unit: 'g', target: '', portion: '' });
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
            await dispatchDomainOperation({ type: 'supplement.upsert', supplement: duplicated });
            await showAlert('Integratore duplicato!');
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



    const renderDateNavigator = () => (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <button className="btn btn-small" onClick={handlePrevDay} style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-main)' }}>◀ Prec.</button>
            <div style={{ textAlign: 'center', flex: 1, margin: '0 10px', cursor: 'pointer' }} onClick={handleToday} title="Torna a oggi">
                <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>
                    {Logic.formatItalianDate ? Logic.formatItalianDate(targetDateStr || '') : targetDateStr}
                </div>
                {targetDateStr === Logic.getLocalDateString() && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--primary-color)' }}>OGGI</div>
                )}
            </div>
            <button className="btn btn-small" onClick={handleNextDay} disabled={targetDateStr === Logic.getLocalDateString()} style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-main)', opacity: targetDateStr === Logic.getLocalDateString() ? 0.3 : 1 }}>Succ. ▶</button>
        </div>
    );

    return (
        <div>
            {setSelectedDate && renderDateNavigator()}

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
                <div className="card mb-15" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--primary-color)' }}>
                    <h2 className="mb-15" style={{color: 'var(--text-main)'}}>
                        {editingSuppId ? 'Modifica integratore' : 'Crea nuovo integratore'}
                    </h2>
                    
                    <div className="form-group">
                        <label>Nome integratore</label>
                        <input 
                            type="text" 
                            placeholder="es. Creatina, EAA, Caffeina" 
                            value={suppForm.name} 
                            onChange={e => setSuppForm({...suppForm, name: e.target.value})}
                            style={{ width: '100%', boxSizing: 'border-box' }}
                        />
                    </div>
                    
                    <div style={{ display: 'flex', gap: '15px' }}>
                        <div className="form-group" style={{ flex: 1, minWidth: 0 }}>
                            <label>Dose target giornaliera</label>
                            <input 
                                type="number" 
                                inputMode="decimal"
                                placeholder="Opzionale (es. 5)" 
                                value={suppForm.target} 
                                onChange={e => setSuppForm({...suppForm, target: e.target.value})}
                                style={{ width: '100%', boxSizing: 'border-box', appearance: 'none' }}
                            />
                        </div>
                        <div className="form-group" style={{ flex: 1, minWidth: 0 }}>
                            <label>Dose singola (opzionale)</label>
                            <input 
                                type="number" 
                                inputMode="decimal"
                                placeholder="es. 20" 
                                value={suppForm.portion} 
                                onChange={e => setSuppForm({...suppForm, portion: e.target.value})}
                                style={{ width: '100%', boxSizing: 'border-box', appearance: 'none' }}
                            />
                        </div>
                        <div className="form-group" style={{ flex: 1, minWidth: 0 }}>
                            <label>Unità di misura</label>
                            <input 
                                type="text" 
                                placeholder="es. g, mg, cp" 
                                value={suppForm.unit} 
                                onChange={e => setSuppForm({...suppForm, unit: e.target.value})}
                                style={{ width: '100%', boxSizing: 'border-box' }}
                            />
                        </div>
                    </div>

                    <div className="flex-between mt-20">
                        <button className="btn" onClick={() => {
                            setShowSuppModal(false);
                            setEditingSuppId(null);
                        }}>Annulla</button>
                        <button className="btn btn-primary" onClick={handleSaveSupplement}>Salva</button>
                    </div>
                </div>
            )}

            {supplementsLibrary.length === 0 ? (
                <p className="text-muted text-center my-20">Non hai ancora aggiunto alcun integratore. Creane uno per iniziare a tracciarlo.</p>
            ) : (
                [...supplementsLibrary]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((supp) => {
                    const suppIntakes = supplementsIntake.filter(i => i.supplementId === supp.id);
                    const totalAssunto = suppIntakes.reduce((acc, curr) => acc + curr.amount, 0);
                    const progressPercent = supp.target ? Math.min((totalAssunto / supp.target) * 100, 100) : 0;
                    
                    return (
                        <div key={supp.id} className="card mb-15">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                <div>
                                    <div style={{ fontWeight: 'bold', fontSize: '1.1rem', color: 'var(--text-main)' }}>{supp.name}</div>
                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                        Assunto: <strong style={{ color: 'var(--text-main)' }}>{Math.round(totalAssunto * 10) / 10}</strong> {supp.unit} 
                                        {supp.target ? ` / ${supp.target} ${supp.unit}` : ''}
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

                            {supp.target && (
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
                                    value={quickInputs[supp.id] !== undefined ? quickInputs[supp.id] : (supp.portion ? String(supp.portion) : '')}
                                    onChange={e => setQuickInputs({ ...quickInputs, [supp.id]: e.target.value })}
                                    onFocus={e => e.target.select()}
                                    style={{ margin: 0, flex: 1, appearance: 'none', WebkitAppearance: 'none' }}
                                />
                                <button 
                                    className="btn btn-primary" 
                                    style={{ margin: 0, whiteSpace: 'nowrap', flex: 1 }}
                                    onClick={async () => {
                                        try {
                                            let valStr = quickInputs[supp.id];
                                            if (valStr === undefined) {
                                                valStr = supp.portion ? String(supp.portion) : '';
                                            }
                                            const valNum = parseFloat(valStr.replace(',', '.'));
                                            
                                            if (!valStr || isNaN(valNum) || valNum <= 0) {
                                                await showAlert("Inserisci una quantità valida da assumere.");
                                                return;
                                            }
                                            
                                            await addIntake(supp.id, valNum);
                                            
                                            setQuickInputs(prev => {
                                                const next = { ...prev };
                                                delete next[supp.id];
                                                return next;
                                            });
                                        } catch (e: any) {
                                            await showAlert("Errore durante l'aggiunta: " + (e.message || String(e)));
                                        }
                                    }}
                                    disabled={false}
                                >
                                    + Aggiungi
                                </button>
                            </div>

                            {suppIntakes.length > 0 && (
                                <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '8px', padding: '10px' }}>
                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '8px' }}>Storico odierno:</div>
                                    {suppIntakes.map(intake => {
                                        const timeStr = new Date(intake.time).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
                                        return (
                                            <div key={intake.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px dashed rgba(255,255,255,0.1)' }}>
                                                <div style={{ fontSize: '0.95rem' }}>
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


