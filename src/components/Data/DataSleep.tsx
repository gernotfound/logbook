import { ChevronDown, Moon, Pencil, Save, X } from 'lucide-react';
import { Logic } from '../../lib/logic';
import { shiftDateString } from '../../lib/utils/date';
import DataDateNavigator from './DataDateNavigator';

interface DataSleepProps {
    sleepHook: any;
    selectedDate?: string;
    setSelectedDate?: (d: string) => void;
    todayDateStr?: string;
}

interface SleepFieldProps {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
}

function SleepField({ id, label, value, onChange }: SleepFieldProps) {
    return (
        <div style={{ minWidth: 0 }}>
            <label className="data-field" htmlFor={id}>
                {label}
                <span className="data-clearable-input">
                    <input
                        id={id}
                        type="time"
                        value={value}
                        onChange={event => onChange(event.target.value)}
                        onFocus={event => event.target.select()}
                    />
                    {value && (
                        <button type="button" onClick={() => onChange('')} aria-label={`Cancella ${label.toLowerCase()}`}>
                            <X size={16} aria-hidden="true" />
                        </button>
                    )}
                </span>
            </label>
        </div>
    );
}

const DataSleep: React.FC<DataSleepProps> = ({ sleepHook, selectedDate, setSelectedDate, todayDateStr }) => {
    const today = todayDateStr || Logic.getLocalDateString();
    const isEditing = Boolean(sleepHook.editingDate);
    const activeDateStr = selectedDate || sleepHook.editingDate || today;

    return (
        <div className="data-page-grid">
            {setSelectedDate && (
                <DataDateNavigator
                    date={activeDateStr}
                    today={today}
                    onPrevious={() => setSelectedDate(shiftDateString(activeDateStr, -1))}
                    onNext={() => {
                        if (activeDateStr !== today) setSelectedDate(shiftDateString(activeDateStr, 1));
                    }}
                    onToday={() => setSelectedDate(today)}
                />
            )}

            <section
                id="sleep-form-card"
                className={`section-divider data-panel${isEditing ? ' data-panel-editing' : ''}`}
                aria-labelledby="sleep-panel-title"
            >
                <div className="data-panel-head">
                    <div>
                        <h2 id="sleep-panel-title" className="data-panel-title">
                            {isEditing ? <Pencil size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
                            {isEditing ? 'Modifica sonno' : 'Dati sonno'}
                        </h2>
                        <p>Registra durata totale e fasi della notte.</p>
                    </div>
                    <span className="data-icon-tile" aria-hidden="true"><Moon size={20} /></span>
                </div>

                <div className="data-form-grid">
                    <label className="data-field data-field-full" style={{ minWidth: 0 }} htmlFor="sleep-hours">
                        Ore di sonno totali
                        <span className="data-clearable-input">
                            <input
                                id="sleep-hours"
                                type="time"
                                value={sleepHook.sleepHours}
                                onChange={event => sleepHook.setSleepHours(event.target.value)}
                                onFocus={event => event.target.select()}
                            />
                            {sleepHook.sleepHours && (
                                <button type="button" onClick={() => sleepHook.setSleepHours('')} aria-label="Cancella ore sonno">
                                    <X size={18} aria-hidden="true" />
                                </button>
                            )}
                        </span>
                    </label>
                </div>

                <details className="data-disclosure">
                    <summary>
                        <span className="data-icon-tile" aria-hidden="true"><Moon size={20} /></span>
                        <span className="data-disclosure-copy">
                            <strong>Dettagli fasi</strong>
                            <small>Profondo, leggero, REM e tempo sveglio · opzionali</small>
                        </span>
                        <ChevronDown className="data-disclosure-chevron" size={20} aria-hidden="true" />
                    </summary>
                    <div className="data-disclosure-body">
                        <div className="input-row data-form-grid">
                            <SleepField id="sleep-deep" label="Sonno profondo" value={sleepHook.sleepDeep} onChange={sleepHook.setSleepDeep} />
                            <SleepField id="sleep-light" label="Sonno leggero" value={sleepHook.sleepLight} onChange={sleepHook.setSleepLight} />
                            <SleepField id="sleep-rem" label="Sonno REM" value={sleepHook.sleepRem} onChange={sleepHook.setSleepRem} />
                            <SleepField id="sleep-awake" label="Tempo sveglio" value={sleepHook.sleepAwake} onChange={sleepHook.setSleepAwake} />
                        </div>
                    </div>
                </details>

                <div className="data-action-row">
                    {isEditing && (
                        <button type="button" className="btn" onClick={() => sleepHook.setEditingDate(null)}>
                            Annulla
                        </button>
                    )}
                    <button type="button" className="btn btn-primary" onClick={sleepHook.saveSleep}>
                        <Save size={16} aria-hidden="true" />
                        {isEditing ? 'Salva modifiche' : 'Salva sonno'}
                    </button>
                </div>
            </section>
        </div>
    );
};

export default DataSleep;
