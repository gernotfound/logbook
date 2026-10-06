import { useEffect, useMemo, useState } from 'react';
import { Activity, ChevronDown, Pencil, Plus, Ruler, Save, UserRound, X } from 'lucide-react';
import { Logic } from '../../lib/logic';
import { shiftDateString } from '../../lib/utils/date';
import type { BodyFatProvenance } from '../../types';
import type { BodyFatMode } from '../../hooks/useNutritionMeasurements';
import DataDateNavigator from './DataDateNavigator';

interface DataMeasurementsProps {
    profile: any;
    selectedDate?: string;
    setSelectedDate?: (d: string) => void;
    targetDateStr?: string;
    editingDate?: string | null;
    hasExistingData?: boolean;
    bfProvenance?: BodyFatProvenance;
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
    calculateAndSave: (e?: any, bodyFatMode?: BodyFatMode) => Promise<unknown>;
    onOpenBiometry?: () => void;
}

interface MeasurementFieldProps {
    id: string;
    label: string;
    value: string;
    unit?: string;
    onChange: (value: string) => void;
    full?: boolean;
}

function MeasurementField({
    id,
    label,
    value,
    unit = 'cm',
    onChange,
    full = false,
}: MeasurementFieldProps) {
    return (
        <label className={`data-field${full ? ' data-field-full' : ''}`} style={{ minWidth: 0 }}>
            {label}
            <span className="data-input-with-unit" style={{ minWidth: 0 }}>
                <input
                    id={id}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.1"
                    value={value}
                    placeholder="—"
                    onChange={event => onChange(event.target.value)}
                    onFocus={event => event.target.select()}
                />
                <span className="data-input-unit">{unit}</span>
            </span>
        </label>
    );
}

const DataMeasurements: React.FC<DataMeasurementsProps> = ({
    profile,
    selectedDate,
    setSelectedDate,
    targetDateStr,
    editingDate,
    hasExistingData,
    bfProvenance,
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
    calculateAndSave,
    onOpenBiometry,
}) => {
    const activeDateStr = targetDateStr || selectedDate || editingDate || Logic.getLocalDateString();
    const todayStr = Logic.getLocalDateString();
    const isEditing = Boolean(editingDate || hasExistingData);
    const [bfMode, setBfMode] = useState<BodyFatMode>(
        bfProvenance?.method === 'us_navy' ? 'calculate' : 'manual'
    );

    useEffect(() => {
        setBfMode(bfProvenance?.method === 'us_navy' ? 'calculate' : 'manual');
    }, [activeDateStr, bfProvenance?.method]);

    const isFemale = profile?.gender === 'F';
    const profileComplete = Boolean((profile?.gender === 'M' || profile?.gender === 'F') && Number(profile?.height) > 0);
    const estimate = useMemo(() => {
        if (!profileComplete) {
            return {
                value: 'Profilo incompleto',
                detail: 'Completa altezza e sesso nella pagina Biometria.',
            };
        }
        if (!waist || !neck || (isFemale && !hip)) {
            return {
                value: 'Inserisci le misure richieste',
                detail: isFemale ? 'Servono vita, collo e fianchi.' : 'Servono vita e collo.',
            };
        }
        const value = Logic.calculateBodyFatByMethod(isFemale ? 'navy_female' : 'navy_male', {
            gender: profile.gender,
            height: Number(profile.height),
            weight: Number(weight),
            waist: Number(waist),
            neck: Number(neck),
            hip: hip ? Number(hip) : undefined,
        });
        return value === null
            ? { value: 'Controlla le misure', detail: 'I valori non permettono una stima attendibile.' }
            : { value: `${value.toLocaleString('it-IT', { maximumFractionDigits: 1 })}%`, detail: 'Metodo US Navy · valore indicativo.' };
    }, [hip, isFemale, neck, profile?.gender, profile?.height, profileComplete, waist, weight]);

    const handlePrevDay = () => setSelectedDate?.(shiftDateString(activeDateStr, -1));
    const handleNextDay = () => {
        if (activeDateStr !== todayStr) setSelectedDate?.(shiftDateString(activeDateStr, 1));
    };

    const otherFields = [
        ...(bfMode === 'manual'
            ? [
                { id: 'measure-waist', label: 'Vita', value: waist, setValue: setWaist },
                { id: 'measure-neck', label: 'Collo', value: neck, setValue: setNeck },
                ...(isFemale ? [{ id: 'measure-hip', label: 'Fianchi', value: hip, setValue: setHip }] : []),
            ]
            : []),
        { id: 'measure-chest', label: 'Torace', value: chest, setValue: setChest },
        { id: 'measure-shoulders', label: 'Spalle', value: shoulders, setValue: setShoulders },
        { id: 'measure-biceps', label: 'Braccia', value: biceps, setValue: setBiceps },
        { id: 'measure-thighs', label: 'Cosce', value: thighs, setValue: setThighs },
        { id: 'measure-calves', label: 'Polpacci', value: calves, setValue: setCalves },
    ];

    return (
        <div className="data-page-grid">
            {setSelectedDate && (
                <DataDateNavigator
                    date={activeDateStr}
                    today={todayStr}
                    onPrevious={handlePrevDay}
                    onNext={handleNextDay}
                    onToday={() => setSelectedDate(todayStr)}
                />
            )}

            <section
                id="measurement-form-card"
                className={`section-divider data-panel${isEditing ? ' data-panel-editing' : ''}`}
                aria-labelledby="measurement-form-title"
            >
                <div className="data-panel-head">
                    <div>
                        <h2 id="measurement-form-title" className="data-panel-title">
                            {isEditing ? <Pencil size={20} aria-hidden="true" /> : <Plus size={20} aria-hidden="true" />}
                            {isEditing ? 'Modifica misurazione' : 'Nuova misurazione'}
                        </h2>
                        <p>Registra peso, massa grassa e circonferenze corporee.</p>
                    </div>
                    <span className="data-icon-tile" aria-hidden="true"><Ruler size={20} /></span>
                </div>

                <h3 className="data-section-label">Dati principali</h3>
                <div className="data-form-grid">
                    <label className="data-field data-field-full" style={{ minWidth: 0 }}>
                        Orario rilevazione
                        <span className="data-clearable-input">
                            <input
                                id="measure-time"
                                type="time"
                                value={measureTime}
                                onChange={event => setMeasureTime(event.target.value)}
                            />
                            {measureTime && (
                                <button type="button" onClick={() => setMeasureTime('')} aria-label="Cancella orario">
                                    <X size={18} aria-hidden="true" />
                                </button>
                            )}
                        </span>
                    </label>
                    <MeasurementField
                        id="measure-weight"
                        label="Peso"
                        value={weight}
                        unit="kg"
                        onChange={setWeight}
                        full
                    />
                </div>

                <fieldset className="data-bf-method">
                    <legend>Massa grassa</legend>
                    <div className="data-method-switch">
                        <label className={`data-method-option${bfMode === 'manual' ? ' selected' : ''}`}>
                            <input
                                type="radio"
                                name="body-fat-method"
                                value="manual"
                                checked={bfMode === 'manual'}
                                onChange={() => setBfMode('manual')}
                            />
                            <span className="data-method-dot" aria-hidden="true" />
                            <span>
                                <strong>BF manuale</strong>
                                <small>Inserisco direttamente la percentuale</small>
                            </span>
                        </label>
                        <label className={`data-method-option${bfMode === 'calculate' ? ' selected' : ''}`}>
                            <input
                                type="radio"
                                name="body-fat-method"
                                value="calculate"
                                checked={bfMode === 'calculate'}
                                onChange={() => setBfMode('calculate')}
                            />
                            <span className="data-method-dot" aria-hidden="true" />
                            <span>
                                <strong>Calcolo da misure</strong>
                                <small>Stima con il metodo US Navy</small>
                            </span>
                        </label>
                    </div>
                    <p className="data-method-help">Puoi cambiare metodo senza perdere i valori già inseriti.</p>
                </fieldset>

                {bfMode === 'manual' ? (
                    <div className="data-form-grid">
                        <label className="data-field data-field-full" style={{ minWidth: 0 }}>
                            Massa grassa (BF)
                            <span className="data-input-with-unit" style={{ minWidth: 0 }}>
                                <input
                                    id="measure-bf"
                                    type="number"
                                    inputMode="decimal"
                                    min="0"
                                    max="100"
                                    step="0.1"
                                    value={manualBf}
                                    placeholder="—"
                                    onChange={event => setManualBf(event.target.value)}
                                    onFocus={event => event.target.select()}
                                />
                                <span className="data-input-unit">%</span>
                            </span>
                        </label>
                    </div>
                ) : (
                    <div className="data-calculation-flow">
                        <div className="data-calculation-profile">
                            <span>
                                <small>Profilo usato per il calcolo</small>
                                <strong>
                                    {profile?.gender === 'F' ? 'Donna' : profile?.gender === 'M' ? 'Uomo' : 'Sesso non specificato'}
                                    {' · '}
                                    {Number(profile?.height) > 0 ? `${profile.height} cm` : 'altezza mancante'}
                                </strong>
                            </span>
                            {onOpenBiometry && (
                                <button type="button" className="btn" onClick={onOpenBiometry}>
                                    <UserRound size={16} aria-hidden="true" /> Controlla profilo
                                </button>
                            )}
                        </div>
                        <div className="data-form-grid">
                            <MeasurementField id="measure-waist" label="Vita" value={waist} onChange={setWaist} />
                            <MeasurementField id="measure-neck" label="Collo" value={neck} onChange={setNeck} />
                            {isFemale && (
                                <MeasurementField id="measure-hip" label="Fianchi" value={hip} onChange={setHip} full />
                            )}
                        </div>
                        <output className="data-calculation-preview" aria-live="polite">
                            <span>BF stimata</span>
                            <strong>{estimate.value}</strong>
                            <small>{estimate.detail}</small>
                        </output>
                    </div>
                )}

                <details className="data-disclosure">
                    <summary>
                        <span className="data-icon-tile" aria-hidden="true"><Activity size={20} /></span>
                        <span className="data-disclosure-copy">
                            <strong>Altre misurazioni</strong>
                            <small>{otherFields.length} campi opzionali · le misure usate nel calcolo non vengono duplicate</small>
                        </span>
                        <ChevronDown className="data-disclosure-chevron" size={20} aria-hidden="true" />
                    </summary>
                    <div className="data-disclosure-body">
                        {bfMode === 'manual' && (
                            <p className="data-disclosure-note">
                                Vita e collo restano misure indipendenti dalla percentuale di massa grassa inserita.
                            </p>
                        )}
                        <div className="data-form-grid">
                            {otherFields.map(field => (
                                <MeasurementField
                                    key={field.id}
                                    id={field.id}
                                    label={field.label}
                                    value={field.value}
                                    onChange={field.setValue}
                                />
                            ))}
                        </div>
                    </div>
                </details>

                <div className="data-action-row">
                    {isEditing && (
                        <button type="button" className="btn" onClick={handleCancelEdit}>
                            Annulla
                        </button>
                    )}
                    <button
                        type="button"
                        className="btn btn-primary"
                        onClick={event => void calculateAndSave(event, bfMode)}
                    >
                        <Save size={16} aria-hidden="true" />
                        {isEditing ? 'Salva modifiche' : 'Salva misurazione'}
                    </button>
                </div>
            </section>
        </div>
    );
};

export default DataMeasurements;
