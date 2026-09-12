import React from 'react';
import { ChevronLeft, ChevronRight, Clock3, Save, X } from 'lucide-react';
import { shiftDateString } from '../../lib/utils/date';
import { Logic } from '../../lib/logic';

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
    calculateAndSave: (e?: any) => Promise<unknown>;
}

interface MeasurementFieldProps {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
}

const MeasurementField = ({ id, label, value, onChange, placeholder }: MeasurementFieldProps) => (
    <label className="field-stack measurement-field">
        <span className="field-label">{label}</span>
        <input
            id={id}
            type="number"
            inputMode="decimal"
            step="0.1"
            placeholder={placeholder}
            value={value}
            onChange={event => onChange(event.target.value)}
            onFocus={event => event.target.select()}
        />
    </label>
);

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
        setSelectedDate(shiftDateString(activeDateStr, -1));
    };

    const handleNextDay = () => {
        if (!setSelectedDate || activeDateStr === todayStr) return;
        setSelectedDate(shiftDateString(activeDateStr, 1));
    };

    const handleToday = () => {
        if (setSelectedDate) setSelectedDate(todayStr);
    };

    return (
        <div className="data-measurements-view">
            {setSelectedDate && (
                <div className="date-navigator" aria-label="Seleziona data misurazione">
                    <button className="date-navigator__button" type="button" onClick={handlePrevDay} aria-label="Giorno precedente">
                        <ChevronLeft size={18} aria-hidden="true" />
                    </button>
                    <button className="date-navigator__current" type="button" onClick={handleToday} title="Torna a oggi">
                        <span>{Logic.formatItalianDate ? Logic.formatItalianDate(activeDateStr) : activeDateStr}</span>
                        {activeDateStr === todayStr && <small>Oggi</small>}
                    </button>
                    <button className="date-navigator__button" type="button" onClick={handleNextDay} disabled={activeDateStr === todayStr} aria-label="Giorno successivo">
                        <ChevronRight size={18} aria-hidden="true" />
                    </button>
                </div>
            )}

            <section id="measurement-form-card" className={`measurement-form ${isEditing ? 'is-editing' : ''}`}>
                <header className="measurement-form__header">
                    <div>
                        <span className="page-header__eyebrow">Composizione corporea</span>
                        <h2>{isEditing ? 'Modifica misurazione' : 'Nuova misurazione'}</h2>
                        <p>Registra peso, massa grassa e circonferenze. I campi non necessari possono restare vuoti.</p>
                    </div>
                </header>

                <div className="measurement-time-row">
                    <label className="field-stack measurement-time-field">
                        <span className="field-label"><Clock3 size={14} aria-hidden="true" /> Orario rilevazione</span>
                        <span className="measurement-time-control">
                            <input id="measure-time" type="time" value={measureTime} onChange={event => setMeasureTime(event.target.value)} />
                            {measureTime && (
                                <button type="button" className="measurement-time-clear" onClick={() => setMeasureTime('')} aria-label="Cancella orario">
                                    <X size={17} aria-hidden="true" />
                                </button>
                            )}
                        </span>
                    </label>
                </div>

                <section className="measurement-section">
                    <div className="measurement-section__heading">
                        <h3>Dati principali</h3>
                        <span>Base</span>
                    </div>
                    <div className="form-grid form-grid--two">
                        <MeasurementField id="measure-weight" label="Peso (kg)" value={weight} onChange={setWeight} placeholder="0.0" />
                        <MeasurementField id="measure-bf" label="BF % (bilancia)" value={manualBf} onChange={setManualBf} placeholder="Opzionale" />
                    </div>
                </section>

                <section className="measurement-section">
                    <div className="measurement-section__heading">
                        <h3>Circonferenze</h3>
                        <span>Opzionali</span>
                    </div>
                    <p className="measurement-section__hint">Se la BF % non è disponibile, LogBook può stimarla con il metodo US Navy usando le circonferenze necessarie.</p>
                    <div className="form-grid form-grid--two">
                        <MeasurementField id="measure-waist" label="Vita (cm)" value={waist} onChange={setWaist} />
                        <MeasurementField id="measure-neck" label="Collo (cm)" value={neck} onChange={setNeck} />
                        {profile.gender === 'F' && <MeasurementField id="measure-hip" label="Fianchi (cm)" value={hip} onChange={setHip} />}
                    </div>
                </section>

                <section className="measurement-section measurement-section--secondary">
                    <div className="measurement-section__heading">
                        <h3>Altre misure</h3>
                        <span>Bodybuilding</span>
                    </div>
                    <div className="form-grid form-grid--two">
                        <MeasurementField id="measure-chest" label="Torace (cm)" value={chest} onChange={setChest} />
                        <MeasurementField id="measure-shoulders" label="Spalle (cm)" value={shoulders} onChange={setShoulders} />
                        <MeasurementField id="measure-biceps" label="Braccia (cm)" value={biceps} onChange={setBiceps} />
                        <MeasurementField id="measure-thighs" label="Cosce (cm)" value={thighs} onChange={setThighs} />
                        <MeasurementField id="measure-calves" label="Polpacci (cm)" value={calves} onChange={setCalves} />
                    </div>
                </section>

                <div className="measurement-actions">
                    {isEditing && (
                        <button className="btn btn-secondary" type="button" onClick={handleCancelEdit}>Annulla</button>
                    )}
                    <button className="btn btn-primary" type="button" onClick={calculateAndSave}>
                        <Save size={18} aria-hidden="true" />
                        {isEditing ? 'Salva modifiche' : 'Salva misurazione'}
                    </button>
                </div>
            </section>
        </div>
    );
};

export default DataMeasurements;
