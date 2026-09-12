import React from 'react';
import { shiftDateString } from '../../lib/utils/date';
import { Logic } from '../../lib/logic';
import { Pencil, X, Save } from 'lucide-react';

interface DataSleepProps {
    sleepHook: any;
    selectedDate?: string;
    setSelectedDate?: (d: string) => void;
    todayDateStr?: string;
}

const DataSleep: React.FC<DataSleepProps> = ({ sleepHook, selectedDate, setSelectedDate, todayDateStr }) => {
    const today = todayDateStr || Logic.getLocalDateString();

    const isEditing = !!sleepHook.editingDate;
    const activeDateStr = selectedDate || sleepHook.editingDate || today;

    const handlePrevDay = () => {
        if (!setSelectedDate) return;
        setSelectedDate(shiftDateString(activeDateStr, -1));
    };

    const handleNextDay = () => {
        if (!setSelectedDate) return;
        if (activeDateStr === today) return;
        setSelectedDate(shiftDateString(activeDateStr, 1));
    };

    const handleToday = () => {
        if (setSelectedDate) setSelectedDate(today);
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
                        {activeDateStr === today && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--primary-color)' }}>OGGI</div>
                        )}
                    </div>
                    <button
                        className="btn btn-small"
                        onClick={handleNextDay}
                        disabled={activeDateStr === today}
                        style={{
                            background: 'rgba(255,255,255,0.05)',
                            color: 'var(--text-main)',
                            opacity: activeDateStr === today ? 0.3 : 1
                        }}
                    >
                        Succ. ▶
                    </button>
                </div>
            )}

            <div id="sleep-form-card" className="section-divider" style={isEditing ? { border: '2px solid var(--primary-color)', padding: '15px', borderRadius: '12px' } : undefined}>
                <h2 style={{color: isEditing ? 'var(--primary-color)' : 'white',marginBottom: '10px', marginTop: 0}}>
                    {isEditing ? <><Pencil size={18} aria-hidden="true" /> Modifica sonno ({activeDateStr})</> : <>🌙 Dati sonno ({activeDateStr})</>}
                </h2>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '20px' }}>
                    Registra la durata e la qualità del tuo sonno.
                </p>

                <div style={{ display: 'flex', gap: '15px', marginBottom: '20px', justifyContent: 'center' }}>
                    <div style={{ flex: 1, minWidth: 0, maxWidth: '200px' }}>
                        <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '8px', textAlign: 'center' }}>Ore sonno (totali)</label>
                        <div style={{ position: 'relative' }}>
                            <input
                                id="sleep-hours"
                                type="time"
                                placeholder="07:30"
                                value={sleepHook.sleepHours}
                                onChange={e => sleepHook.setSleepHours(e.target.value)}
                                onFocus={e => e.target.select()}
                                style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', fontWeight: 'bold', fontSize: '16px', padding: '10px', paddingRight: '35px', margin: 0 }}
                            />
                            {sleepHook.sleepHours && (
                                <button
                                    type="button"
                                    onClick={() => sleepHook.setSleepHours('')}
                                    style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px' }}
                                    aria-label="Cancella ore sonno"
                                >
                                    <X size={18} />
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                <div style={{ width: '100%', height: '1px', background: 'var(--glass-border)', margin: '20px 0' }}></div>
                <h3 style={{color: 'var(--text-muted)', marginBottom: '15px'}}>Dettagli fasi (opzionali)</h3>

                <div className="input-row" style={{ marginBottom: '15px', display: 'flex', gap: '12px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textAlign: 'center' }}>Sonno profondo</label>
                        <div style={{ position: 'relative' }}>
                            <input
                                id="sleep-deep"
                                type="time"
                                placeholder="01:30"
                                value={sleepHook.sleepDeep}
                                onChange={e => sleepHook.setSleepDeep(e.target.value)}
                                onFocus={e => e.target.select()}
                                style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', margin: '0 auto', fontSize: '16px', paddingRight: '35px' }}
                            />
                            {sleepHook.sleepDeep && (
                                <button
                                    type="button"
                                    onClick={() => sleepHook.setSleepDeep('')}
                                    style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px' }}
                                    aria-label="Cancella sonno profondo"
                                >
                                    <X size={16} />
                                </button>
                            )}
                        </div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textAlign: 'center' }}>Sonno leggero</label>
                        <div style={{ position: 'relative' }}>
                            <input
                                id="sleep-light"
                                type="time"
                                placeholder="04:00"
                                value={sleepHook.sleepLight}
                                onChange={e => sleepHook.setSleepLight(e.target.value)}
                                onFocus={e => e.target.select()}
                                style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', margin: '0 auto', fontSize: '16px', paddingRight: '35px' }}
                            />
                            {sleepHook.sleepLight && (
                                <button
                                    type="button"
                                    onClick={() => sleepHook.setSleepLight('')}
                                    style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px' }}
                                    aria-label="Cancella sonno leggero"
                                >
                                    <X size={16} />
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                <div className="input-row" style={{ marginBottom: '15px', display: 'flex', gap: '12px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textAlign: 'center' }}>Sonno REM</label>
                        <div style={{ position: 'relative' }}>
                            <input
                                id="sleep-rem"
                                type="time"
                                placeholder="01:30"
                                value={sleepHook.sleepRem}
                                onChange={e => sleepHook.setSleepRem(e.target.value)}
                                onFocus={e => e.target.select()}
                                style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', margin: '0 auto', fontSize: '16px', paddingRight: '35px' }}
                            />
                            {sleepHook.sleepRem && (
                                <button
                                    type="button"
                                    onClick={() => sleepHook.setSleepRem('')}
                                    style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px' }}
                                    aria-label="Cancella sonno REM"
                                >
                                    <X size={16} />
                                </button>
                            )}
                        </div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textAlign: 'center' }}>Tempo sveglio</label>
                        <div style={{ position: 'relative' }}>
                            <input
                                id="sleep-awake"
                                type="time"
                                placeholder="00:30"
                                value={sleepHook.sleepAwake}
                                onChange={e => sleepHook.setSleepAwake(e.target.value)}
                                onFocus={e => e.target.select()}
                                style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', margin: '0 auto', fontSize: '16px', paddingRight: '35px' }}
                            />
                            {sleepHook.sleepAwake && (
                                <button
                                    type="button"
                                    onClick={() => sleepHook.setSleepAwake('')}
                                    style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px' }}
                                    aria-label="Cancella tempo sveglio"
                                >
                                    <X size={16} />
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', marginTop: '25px' }}>
                    {isEditing && (
                        <button className="btn" style={{ flex: 1, background: 'rgba(255,255,255,0.1)' }} onClick={() => sleepHook.setEditingDate(null)}>
                            Annulla
                        </button>
                    )}
                    <button className="btn btn-primary" style={{ flex: 2 }} onClick={sleepHook.saveSleep}>
                        {isEditing ? <><Save size={16} aria-hidden="true" /> Salva modifiche</> : <><Save size={16} aria-hidden="true" /> Salva sonno</>}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DataSleep;
