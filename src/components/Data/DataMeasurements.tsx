import React from 'react';
import { shiftDateString } from '../../lib/utils/date';
import { Logic } from '../../lib/logic';
import { Pencil, Plus, Save } from 'lucide-react';
import { DayNavigator } from '../Nutrition/DayNavigator';
import { TrackingTimeField } from '../Nutrition/TrackingTimeField';
import '../Nutrition/TrackingViews.css';

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
        if (!setSelectedDate) return;
        if (activeDateStr === todayStr) return;
        setSelectedDate(shiftDateString(activeDateStr, 1));
    };

    const handleToday = () => {
        if (setSelectedDate) setSelectedDate(todayStr);
    };

    const fields = [
        { id: 'measure-weight', label: 'Peso (kg)', value: weight, onChange: setWeight, placeholder: '0.0' },
        { id: 'measure-bf', label: 'BF % (bilancia)', value: manualBf, onChange: setManualBf, placeholder: 'Opzionale' },
    ];
    const circumferences = [
        { id: 'measure-waist', label: 'Vita (cm)', value: waist, onChange: setWaist },
        { id: 'measure-neck', label: 'Collo (cm)', value: neck, onChange: setNeck },
        ...(profile.gender === 'F' ? [{ id: 'measure-hip', label: 'Fianchi (cm)', value: hip, onChange: setHip }] : []),
    ];
    const otherMeasurements = [
        { id: 'measure-chest', label: 'Torace (cm)', value: chest, onChange: setChest },
        { id: 'measure-shoulders', label: 'Spalle (cm)', value: shoulders, onChange: setShoulders },
        { id: 'measure-biceps', label: 'Braccia (cm)', value: biceps, onChange: setBiceps },
        { id: 'measure-thighs', label: 'Cosce (cm)', value: thighs, onChange: setThighs },
        { id: 'measure-calves', label: 'Polpacci (cm)', value: calves, onChange: setCalves },
    ];

    return (
        <div className="tracking-view">
            {setSelectedDate && <DayNavigator date={activeDateStr} today={todayStr} onPrevious={handlePrevDay} onNext={handleNextDay} onToday={handleToday} />}
            <section id="measurement-form-card" className={`tracking-panel ${isEditing ? 'tracking-panel--editing' : ''}`}>
                <h2 className="tracking-heading">
                    {isEditing ? <><Pencil size={20} aria-hidden="true" /> Modifica misurazione</> : <><Plus size={20} aria-hidden="true" /> Nuova misurazione</>}
                </h2>
                <p className="tracking-description">Registra il tuo peso, la massa grassa e le circonferenze corporee.</p>
                <TrackingTimeField id="measure-time" label="Orario rilevazione" value={measureTime} onChange={setMeasureTime} clearLabel="Cancella orario" />
                <fieldset className="tracking-fieldset">
                    <legend>Dati principali</legend>
                    <div className="tracking-fields">{fields.map(field => <MeasurementField key={field.id} {...field} />)}</div>
                </fieldset>
                <fieldset className="tracking-fieldset">
                    <legend>Misure circonferenze (opzionali)</legend>
                    <p className="tracking-description">Se inserisci questi dati ma non la BF % dalla bilancia, la massa grassa verrà calcolata automaticamente (Metodo US Navy).</p>
                    <div className="tracking-fields">{circumferences.map(field => <MeasurementField key={field.id} {...field} />)}</div>
                </fieldset>
                <fieldset className="tracking-fieldset">
                    <legend>Altre misure (bodybuilding)</legend>
                    <div className="tracking-fields">{otherMeasurements.map(field => <MeasurementField key={field.id} {...field} />)}</div>
                </fieldset>
                <div className="tracking-actions">
                    {isEditing && <button type="button" className="btn btn-secondary" onClick={handleCancelEdit}>Annulla</button>}
                    <button type="button" className="btn btn-primary" onClick={calculateAndSave}>
                        <Save size={20} aria-hidden="true" /> {isEditing ? 'Salva modifiche' : 'Salva misurazione'}
                    </button>
                </div>
            </section>
        </div>
    );
};

function MeasurementField({ id, label, value, onChange, placeholder }: { id: string; label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
    return <div className="tracking-field">
        <label htmlFor={id}>{label}</label>
        <input id={id} type="number" inputMode="decimal" step="0.1" placeholder={placeholder} value={value} onChange={event => onChange(event.target.value)} onFocus={event => event.target.select()} />
    </div>;
}

export default DataMeasurements;
