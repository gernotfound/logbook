import type { Dispatch, SetStateAction } from 'react';

export interface SupplementEditorFormValues {
    name: string;
    unit: string;
    target: string;
    portion: string;
}

interface SupplementEditorFormProps {
    editing: boolean;
    form: SupplementEditorFormValues;
    disabled: boolean;
    setForm: Dispatch<SetStateAction<SupplementEditorFormValues>>;
    onCancel: () => void;
    onSave: () => void;
}

export function SupplementEditorForm({
    editing, form, disabled, setForm, onCancel, onSave,
}: SupplementEditorFormProps) {
    return (
        <div className="card mb-15" style={{ background: 'var(--surface-light)', border: '1px solid var(--primary-color)' }}>
                            <h2 className="mb-15" style={{color: 'var(--text-main)'}}>
                                {editing ? 'Modifica integratore' : 'Crea nuovo integratore'}
                            </h2>
                            
                            <div className="form-group">
                                <label htmlFor="supp-name">Nome integratore</label>
                                <input 
                                    type="text" 
                                    id="supp-name"
                                        placeholder="es. Creatina, EAA, Caffeina" 
                                    value={form.name}
                                        disabled={disabled} 
                                    onChange={e => setForm({...form, name: e.target.value})}
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
                                        value={form.target}
                                        disabled={disabled} 
                                        onChange={e => setForm({...form, target: e.target.value})}
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
                                        value={form.portion}
                                        disabled={disabled} 
                                        onChange={e => setForm({...form, portion: e.target.value})}
                                        style={{ width: '100%', boxSizing: 'border-box', appearance: 'none' }}
                                    />
                                </div>
                                <div className="form-group" style={{ flex: 1, minWidth: 0 }}>
                                    <label htmlFor="supp-unit">Unità di misura</label>
                                    <input 
                                        type="text" 
                                        id="supp-unit"
                                        placeholder="es. g, mg, cp" 
                                        value={form.unit}
                                        disabled={disabled} 
                                        onChange={e => setForm({...form, unit: e.target.value})}
                                        style={{ width: '100%', boxSizing: 'border-box' }}
                                    />
                                </div>
                            </div>
        
                            <div className="flex-between mt-20">
                                <button className="btn" onClick={onCancel} disabled={disabled}>Annulla</button>
                                <button className="btn btn-primary" onClick={onSave} disabled={disabled}>Salva</button>
                            </div>
                        </div>
    );
}
