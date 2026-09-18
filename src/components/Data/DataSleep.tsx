import React from 'react';
import { shiftDateString } from '../../lib/utils/date';
import { Logic } from '../../lib/logic';
import { Pencil, Moon, Save } from 'lucide-react';
import { DayNavigator } from '../Nutrition/DayNavigator';
import { TrackingTimeField } from '../Nutrition/TrackingTimeField';
import '../Nutrition/TrackingViews.css';

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
        <div className="tracking-view">
            {setSelectedDate && <DayNavigator date={activeDateStr} today={today} onPrevious={handlePrevDay} onNext={handleNextDay} onToday={handleToday} />}
            <section id="sleep-form-card" className={`tracking-panel ${isEditing ? 'tracking-panel--editing' : ''}`}>
                <h2 className="tracking-heading">{isEditing ? <Pencil size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />} {isEditing ? 'Modifica sonno' : 'Dati sonno'} ({activeDateStr})</h2>
                <p className="tracking-description">Registra la durata e la qualità del tuo sonno.</p>
                <TrackingTimeField id="sleep-hours" label="Ore sonno (totali)" placeholder="07:30" value={sleepHook.sleepHours} onChange={sleepHook.setSleepHours} clearLabel="Cancella ore sonno" />
                <fieldset className="tracking-fieldset">
                    <legend>Dettagli fasi (opzionali)</legend>
                    <div className="tracking-fields">
                        <TrackingTimeField id="sleep-deep" label="Sonno profondo" placeholder="01:30" value={sleepHook.sleepDeep} onChange={sleepHook.setSleepDeep} clearLabel="Cancella sonno profondo" />
                        <TrackingTimeField id="sleep-light" label="Sonno leggero" placeholder="04:00" value={sleepHook.sleepLight} onChange={sleepHook.setSleepLight} clearLabel="Cancella sonno leggero" />
                        <TrackingTimeField id="sleep-rem" label="Sonno REM" placeholder="01:30" value={sleepHook.sleepRem} onChange={sleepHook.setSleepRem} clearLabel="Cancella sonno REM" />
                        <TrackingTimeField id="sleep-awake" label="Tempo sveglio" placeholder="00:30" value={sleepHook.sleepAwake} onChange={sleepHook.setSleepAwake} clearLabel="Cancella tempo sveglio" />
                    </div>
                </fieldset>
                <div className="tracking-actions">
                    {isEditing && <button type="button" className="btn btn-secondary" onClick={() => sleepHook.setEditingDate(null)}>Annulla</button>}
                    <button type="button" className="btn btn-primary" onClick={sleepHook.saveSleep}><Save size={20} aria-hidden="true" /> {isEditing ? 'Salva modifiche' : 'Salva sonno'}</button>
                </div>
            </section>
        </div>
    );
};

export default DataSleep;
