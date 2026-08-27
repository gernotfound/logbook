import React from 'react';
import { addDays } from 'date-fns';
import { Logic } from '../../lib/logic';
import { X } from 'lucide-react';

interface DataMeasurementsProps {
    profile: any;
    selectedDate?: string;
    setSelectedDate?: (d: string) => void;
    targetDateStr?: string;
    editingDate?: string | null;
    hasExistingData?: boolean;
    measureTime: string;
    setMeasureTime: (val: string) => void;
    weight: string;
    setWeight: (val: string) => void;
    waist: string;
    setWaist: (val: string) => void;
    neck: string;
    setNeck: (val: string) => void;
    hip: string;
    setHip: (val: string) => void;
    manualBf: string;
    setManualBf: (val: string) => void;
    chest: string;
    setChest: (val: string) => void;
    shoulders: string;
    setShoulders: (val: string) => void;
    biceps: string;
    setBiceps: (val: string) => void;
    thighs: string;
    setThighs: (val: string) => void;
    calves: string;
    setCalves: (val: string) => void;
    handleCancelEdit: () => void;
    calculateAndSave: (e?: any) => Promise<void>;
}

const DataMeasurements: React.FC<DataMeasurementsProps> = ({
    profile,
    selectedDate,
    setSelectedDate,
    targetDateStr,
    editingDate,
    hasExistingData,
    measureTime, setMeasureTime,
    weight, setWeight,
    waist, setWaist,
    neck, setNeck,
    hip, setHip,
    manualBf, setManualBf,
    chest, setChest,
    shoulders, setShoulders,
    biceps, setBiceps,
    thighs, setThighs,
    calves, setCalves,
    handleCancelEdit,
    calculateAndSave
}) => {
    const activeDateStr = targetDateStr || selectedDate || editingDate || Logic.getLocalDateString();
    const todayStr = Logic.getLocalDateString();
    const isEditing = Boolean(editingDate || hasExistingData);

    const handlePrevDay = () => {
        if (!setSelectedDate) return;
        const validStr = Logic.parseDateInput(activeDateStr) || activeDateStr;
        const [y, m, d] = validStr.split('-').map(Number);
        const baseDate = (y && m && d) ? new Date(y, m - 1, d) : new Date();
        const prev = addDays(baseDate, -1);
        setSelectedDate(Logic.getLocalDateString(prev));
    };

    const handleNextDay = () => {
        if (!setSelectedDate) return;
        if (activeDateStr === todayStr) return;
        const validStr = Logic.parseDateInput(activeDateStr) || activeDateStr;
        const [y, m, d] = validStr.split('-').map(Number);
        const baseDate = (y && m && d) ? new Date(y, m - 1, d) : new Date();
        const next = addDays(baseDate, 1);
        setSelectedDate(Logic.getLocalDateString(next));
    };

    const handleToday = () => {
        if (setSelectedDate) setSelectedDate(todayStr);
    };

    return (
        <div>
            {/* Date Navigator */}
            {setSelectedDate && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                    <button 
                        className="btn btn-small" 
                        onClick={handlePrevDay} 
                        style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-main)' }}
                    >
                        ◀ Prec.
                    </button>
                    <div 
                        style={{ textAlign: 'center', flex: 1, margin: '0 10px', cursor: 'pointer' }} 
                        onClick={handleToday} 
                        title="Torna a oggi"
                    >
                        <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>
                            {Logic.formatItalianDate ? Logic.formatItalianDate(activeDateStr) : activeDateStr}
                        </div>
                        {activeDateStr === todayStr && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--primary-color)' }}>OGGI</div>
                        )}
                    </div>
                    <button 
                        className="btn btn-small" 
                        onClick={handleNextDay} 
                        disabled={activeDateStr === todayStr} 
                        style={{ 
                            background: 'rgba(255,255,255,0.05)', 
                            color: 'var(--text-main)', 
                            opacity: activeDateStr === todayStr ? 0.3 : 1 
                        }}
                    >
                        Succ. ▶
                    </button>
                </div>
            )}

            <div id="measurement-form-card" className="section-divider" style={isEditing ? { border: '2px solid var(--primary-color)', padding: '15px', borderRadius: '12px' } : undefined}>
                <h2 style={{ color: isEditing ? 'var(--primary-color)' : 'white', fontSize: '1.2rem', marginBottom: '10px', marginTop: 0 }}>
                    {isEditing ? '✏️ Modifica misurazione' : '➕ Nuova misurazione'}
                </h2>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '20px' }}>
                    Registra il tuo peso, la massa grassa e le circonferenze corporee.
                </p>

            <div style={{ display: 'flex', gap: '15px', marginBottom: '20px', justifyContent: 'center' }}>
                <div style={{ flex: 1, minWidth: 0, maxWidth: '200px' }}>
                    <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '8px', textAlign: 'center' }}>Orario rilevazione</label>
                    <div style={{ position: 'relative' }}>
                        <input
                            id="measure-time"
                            type="time"
                            value={measureTime}
                            onChange={e => setMeasureTime(e.target.value)}
                            style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', fontWeight: 'bold', fontSize: '16px', padding: '10px', paddingRight: '35px', margin: 0 }}
                        />
                        {measureTime && (
                            <button
                                type="button"
                                onClick={() => setMeasureTime('')}
                                style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px' }}
                                aria-label="Cancella orario"
                            >
                                <X size={18} />
                            </button>
                        )}
                    </div>
                </div>
            </div>


            {/* SEZIONE 1: Dati principali */}
            <h3 style={{ fontSize: '1rem', color: 'var(--text-main)', margin: '0 0 10px 0', borderBottom: '1px solid var(--glass-border)', paddingBottom: '5px' }}>Dati principali</h3>
            
            <div style={{ display: 'flex', gap: '15px', marginBottom: '25px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '8px', textAlign: 'center' }}>Peso (kg)</label>
                    <input 
                        id="measure-weight" 
                        type="number" 
                        inputMode="decimal"
                        step="0.1" 
                        placeholder="0.0" 
                        value={weight} 
                        onChange={e => setWeight(e.target.value)} 
                        onFocus={e => e.target.select()}
                        style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', fontWeight: 'bold', fontSize: '16px', padding: '10px', margin: 0, lineHeight: 1 }}
                    />
                </div>
                
                <div style={{ flex: 1, minWidth: 0 }}>
                    <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '8px', textAlign: 'center' }}>BF % (Bilancia)</label>
                    <input 
                        id="measure-bf" 
                        type="number" 
                        inputMode="decimal"
                        step="0.1" 
                        placeholder="Opzionale" 
                        value={manualBf} 
                        onChange={e => setManualBf(e.target.value)} 
                        onFocus={e => e.target.select()}
                        style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', fontWeight: 'bold', fontSize: '16px', padding: '10px', margin: 0, lineHeight: 1 }}
                    />
                </div>
            </div>

            {/* SEZIONE 2: Circonferenze opzionali */}
            <h3 style={{ fontSize: '1rem', color: 'var(--text-main)', margin: '0 0 10px 0', borderBottom: '1px solid var(--glass-border)', paddingBottom: '5px' }}>Misure circonferenze (opzionali)</h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '15px' }}>
                Se inserisci questi dati ma non la BF % dalla bilancia, la massa grassa verrà calcolata automaticamente (Metodo US Navy).
            </p>

            <div className="input-row" style={{ marginBottom: '15px', display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textAlign: 'center' }}>Vita (cm)</label>
                    <input 
                        id="measure-waist" 
                        type="number" 
                        inputMode="decimal"
                        step="0.1" 
                        value={waist} 
                        onChange={e => setWaist(e.target.value)} 
                        onFocus={e => e.target.select()}
                        style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', margin: '0 auto', fontSize: '16px' }}
                    />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textAlign: 'center' }}>Collo (cm)</label>
                    <input 
                        id="measure-neck" 
                        type="number" 
                        inputMode="decimal"
                        step="0.1" 
                        value={neck} 
                        onChange={e => setNeck(e.target.value)} 
                        onFocus={e => e.target.select()}
                        style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', margin: '0 auto', fontSize: '16px' }}
                    />
                </div>
            </div>
            
            {profile.gender === 'F' && (
                <div className="input-row" style={{ marginBottom: '15px', display: 'flex', gap: '12px', justifyContent: 'center' }}>
                    <div style={{ width: '50%', minWidth: 0 }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textAlign: 'center' }}>Fianchi (cm)</label>
                        <input 
                            id="measure-hip" 
                            type="number" 
                            inputMode="decimal"
                            step="0.1" 
                            value={hip} 
                            onChange={e => setHip(e.target.value)} 
                            onFocus={e => e.target.select()}
                            style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', margin: '0 auto', fontSize: '16px' }}
                        />
                    </div>
                </div>
            )}

            <div style={{ width: '100%', height: '1px', background: 'var(--glass-border)', margin: '20px 0' }}></div>
            <h3 style={{ fontSize: '1rem', color: 'var(--text-muted)', marginBottom: '15px' }}>Altre misure (Bodybuilding)</h3>

            <div className="input-row" style={{ marginBottom: '15px', display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textAlign: 'center' }}>Torace (cm)</label>
                    <input 
                        id="measure-chest" 
                        type="number" 
                        inputMode="decimal"
                        step="0.1" 
                        value={chest} 
                        onChange={e => setChest(e.target.value)} 
                        onFocus={e => e.target.select()}
                        style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', margin: '0 auto', fontSize: '16px' }}
                    />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textAlign: 'center' }}>Spalle (cm)</label>
                    <input 
                        id="measure-shoulders" 
                        type="number" 
                        inputMode="decimal"
                        step="0.1" 
                        value={shoulders} 
                        onChange={e => setShoulders(e.target.value)} 
                        onFocus={e => e.target.select()}
                        style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', margin: '0 auto', fontSize: '16px' }}
                    />
                </div>
            </div>

            <div className="input-row" style={{ marginBottom: '15px', display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textAlign: 'center' }}>Braccia (cm)</label>
                    <input 
                        id="measure-biceps" 
                        type="number" 
                        inputMode="decimal"
                        step="0.1" 
                        value={biceps} 
                        onChange={e => setBiceps(e.target.value)} 
                        onFocus={e => e.target.select()}
                        style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', margin: '0 auto', fontSize: '16px' }}
                    />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textAlign: 'center' }}>Cosce (cm)</label>
                    <input 
                        id="measure-thighs" 
                        type="number" 
                        inputMode="decimal"
                        step="0.1" 
                        value={thighs} 
                        onChange={e => setThighs(e.target.value)} 
                        onFocus={e => e.target.select()}
                        style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', margin: '0 auto', fontSize: '16px' }}
                    />
                </div>
            </div>

            <div className="input-row" style={{ marginBottom: '15px', display: 'flex', gap: '12px', justifyContent: 'center' }}>
                <div style={{ width: '50%', minWidth: 0 }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textAlign: 'center' }}>Polpacci (cm)</label>
                    <input 
                        id="measure-calves" 
                        type="number" 
                        inputMode="decimal"
                        step="0.1" 
                        value={calves} 
                        onChange={e => setCalves(e.target.value)} 
                        onFocus={e => e.target.select()}
                        style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', margin: '0 auto', fontSize: '16px' }}
                    />
                </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '25px' }}>
                {isEditing && (
                    <button className="btn" style={{ flex: 1, background: 'rgba(255,255,255,0.1)' }} onClick={handleCancelEdit}>
                        Annulla
                    </button>
                )}
                <button className="btn btn-primary" style={{ flex: 2 }} onClick={calculateAndSave}>
                    {isEditing ? '💾 Salva modifiche' : '💾 Salva misurazione'}
                </button>
            </div>
        </div>
    </div>
    );
};

export default DataMeasurements;
