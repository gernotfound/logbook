import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap';
import { useScrollLock } from '../../hooks/useScrollLock';
import { useLocalToday } from '../../hooks/useLocalToday';
import {
    CalendarRange,
    ChevronLeft,
    ChevronRight,
    Pencil,
    Ruler,
    Trash2,
    X,
} from 'lucide-react';
import { Logic } from '../../lib/logic';
import { ContextMenu } from '../UI/ContextMenu';
import type { MeasurementHistoryDay } from '../../types';

interface DataHistoryProps {
    measurementsHistory: MeasurementHistoryDay[];
    editingDate: string | null;
    onSelectEdit: (day: MeasurementHistoryDay) => void;
    onDeleteMeasurement?: (date: string) => void;
}

const MONTH_NAMES = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

function dateFromKey(key: string): Date {
    const [year, month, day] = key.split('-').map(Number);
    return new Date(year, month - 1, day, 12, 0, 0);
}

function monthLabel(key: string): string {
    const [year, month] = key.split('-').map(Number);
    const label = new Intl.DateTimeFormat('it-IT', {
        month: 'long',
        year: 'numeric',
    }).format(new Date(year, month - 1, 1, 12, 0, 0));
    return label.charAt(0).toUpperCase() + label.slice(1);
}

function dayLabel(key: string): string {
    const label = new Intl.DateTimeFormat('it-IT', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    }).format(dateFromKey(key));
    return label.charAt(0).toUpperCase() + label.slice(1);
}

const MEASUREMENT_FIELDS = ['weight', 'bf', 'waist', 'neck', 'hip', 'chest', 'shoulders', 'biceps', 'thighs', 'calves'] as const satisfies readonly (keyof MeasurementHistoryDay)[];

function hasMeasurementData(day: MeasurementHistoryDay): boolean {
    return MEASUREMENT_FIELDS.some(key => day?.[key] !== undefined && day?.[key] !== null && day?.[key] !== '');
}

function hasFiniteValue(value: unknown): boolean {
    return value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value));
}

function finiteAverage(days: MeasurementHistoryDay[], key: 'weight' | 'bf'): number | null {
    const values = days
        .filter(day => hasFiniteValue(day?.[key]))
        .map(day => Number(day[key]));
    if (values.length === 0) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatDecimal(value: number): string {
    return value.toLocaleString('it-IT', { maximumFractionDigits: 1 });
}

function recordSummary(day: MeasurementHistoryDay): string {
    const parts: string[] = [];
    if (hasFiniteValue(day?.weight)) parts.push(`${formatDecimal(Number(day.weight))} kg`);
    if (hasFiniteValue(day?.bf)) parts.push(`BF ${formatDecimal(Number(day.bf))}%`);
    if (hasFiniteValue(day?.waist)) parts.push(`Vita ${formatDecimal(Number(day.waist))} cm`);
    if (day?.sleepHours) parts.push(`Sonno ${Logic.formatSleepTime(day.sleepHours)}`);
    return parts.join(' · ') || 'Dati registrati';
}

interface DataHistoryDetailProps {
    day: MeasurementHistoryDay;
    onClose: () => void;
    onSelectEdit: (day: MeasurementHistoryDay) => void;
}

// Mount the modal lifecycle only while open so focus returns to its actual trigger.
function DataHistoryDetail({ day, onClose, onSelectEdit }: DataHistoryDetailProps) {
    const titleId = useId();
    const dialogRef = useRef<HTMLElement>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    useScrollLock();
    useModalFocusTrap({ containerRef: dialogRef, initialFocusRef: closeButtonRef, onEscape: onClose });

    return (
        <div className="data-detail-layer">
            <button
                className="data-detail-backdrop"
                tabIndex={-1}
                type="button"
                onClick={onClose}
                aria-label="Chiudi dettaglio"
            />
            <section ref={dialogRef} className="data-detail-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
                <div className="data-detail-head">
                    <div>
                        <h2 id={titleId}>Dettaglio dati</h2>
                        <p>
                            {dayLabel(day.date)}
                            {day.measurementTime ? ` · ${day.measurementTime}` : ''}
                        </p>
                    </div>
                    <button ref={closeButtonRef} type="button" className="data-icon-button" onClick={onClose} aria-label="Chiudi dettaglio">
                        <X size={20} aria-hidden="true" />
                    </button>
                </div>
                <div className="data-detail-scroll">
                    <div className="data-detail-grid">
                    {hasFiniteValue(day.weight) && <div><strong>{formatDecimal(Number(day.weight))} kg</strong><span>Peso</span></div>}
                    {hasFiniteValue(day.bf) && <div><strong>{formatDecimal(Number(day.bf))}%</strong><span>BF · {day.bfProvenance?.method === 'manual' ? 'manuale' : day.bfProvenance?.method === 'us_navy' ? 'US Navy' : 'origine n.d.'}</span></div>}
                    {hasFiniteValue(day.waist) && <div><strong>{formatDecimal(Number(day.waist))} cm</strong><span>Vita</span></div>}
                    {hasFiniteValue(day.neck) && <div><strong>{formatDecimal(Number(day.neck))} cm</strong><span>Collo</span></div>}
                    {hasFiniteValue(day.hip) && <div><strong>{formatDecimal(Number(day.hip))} cm</strong><span>Fianchi</span></div>}
                    {hasFiniteValue(day.chest) && <div><strong>{formatDecimal(Number(day.chest))} cm</strong><span>Torace</span></div>}
                    {hasFiniteValue(day.shoulders) && <div><strong>{formatDecimal(Number(day.shoulders))} cm</strong><span>Spalle</span></div>}
                    {hasFiniteValue(day.biceps) && <div><strong>{formatDecimal(Number(day.biceps))} cm</strong><span>Braccia</span></div>}
                    {hasFiniteValue(day.thighs) && <div><strong>{formatDecimal(Number(day.thighs))} cm</strong><span>Cosce</span></div>}
                    {hasFiniteValue(day.calves) && <div><strong>{formatDecimal(Number(day.calves))} cm</strong><span>Polpacci</span></div>}
                    {day.sleepHours && <div><strong>{Logic.formatSleepTime(day.sleepHours)}</strong><span>Sonno</span></div>}
                    </div>
                </div>
                <div className="data-action-row">
                    <button type="button" className="btn" onClick={onClose}>Chiudi</button>
                    {hasMeasurementData(day) && (
                        <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => {
                                onClose();
                                onSelectEdit(day);
                            }}
                        >
                            <Pencil size={16} aria-hidden="true" /> Modifica
                        </button>
                    )}
                </div>
            </section>
        </div>
    );
}

const DataHistory: React.FC<DataHistoryProps> = ({
    measurementsHistory,
    editingDate,
    onSelectEdit,
    onDeleteMeasurement,
}) => {
    const today = useLocalToday();
    const datedHistory = useMemo(
        () => measurementsHistory
            .filter(day => typeof day?.date === 'string' && Logic.parseDateInput(day.date) === day.date)
            .sort((a, b) => b.date.localeCompare(a.date)),
        [measurementsHistory],
    );
    const initialDate = datedHistory[0]?.date || today;
    const [viewMonth, setViewMonth] = useState(() => initialDate.slice(0, 7));
    const [selectedDate, setSelectedDate] = useState(() => initialDate);
    const [periodOpen, setPeriodOpen] = useState(false);
    const [pickerYear, setPickerYear] = useState(() => Number(initialDate.slice(0, 4)));
    const [detailDay, setDetailDay] = useState<MeasurementHistoryDay | null>(null);
    const adoptedInitialHistory = useRef(datedHistory.length > 0);

    useEffect(() => {
        if (adoptedInitialHistory.current || datedHistory.length === 0) return;
        const latest = datedHistory[0].date;
        setSelectedDate(latest);
        setViewMonth(latest.slice(0, 7));
        setPickerYear(Number(latest.slice(0, 4)));
        adoptedInitialHistory.current = true;
    }, [datedHistory]);

    const daysByDate = useMemo(() => {
        const map = new Map<string, MeasurementHistoryDay[]>();
        datedHistory.forEach(day => {
            const current = map.get(day.date);
            if (current) current.push(day);
            else map.set(day.date, [day]);
        });
        return map;
    }, [datedHistory]);

    const daysByMonth = useMemo(() => {
        const map = new Map<string, MeasurementHistoryDay[]>();
        datedHistory.forEach(day => {
            const key = day.date.slice(0, 7);
            const current = map.get(key);
            if (current) current.push(day);
            else map.set(key, [day]);
        });
        return map;
    }, [datedHistory]);

    const monthDays = daysByMonth.get(viewMonth) || [];
    const selectedDays = daysByDate.get(selectedDate) || [];
    const calendarDays = Logic.getCalendarMonthGrid(
        Number(viewMonth.slice(0, 4)),
        Number(viewMonth.slice(5, 7)) - 1,
    );
    const averageWeight = finiteAverage(monthDays, 'weight');
    const averageBf = finiteAverage(monthDays, 'bf');

    const selectMonth = (month: string) => {
        const days = daysByMonth.get(month);
        setViewMonth(month);
        setSelectedDate(days?.[0]?.date || `${month}-01`);
        setPickerYear(Number(month.slice(0, 4)));
        setPeriodOpen(false);
    };

    const changeMonth = (delta: number) => {
        const [year, month] = viewMonth.split('-').map(Number);
        const next = new Date(year, month - 1 + delta, 1, 12, 0, 0);
        selectMonth(Logic.getLocalDateString(next).slice(0, 7));
    };

    const selectToday = () => {
        const currentToday = Logic.getLocalDateString();
        setViewMonth(currentToday.slice(0, 7));
        setSelectedDate(currentToday);
        setPickerYear(Number(currentToday.slice(0, 4)));
        setPeriodOpen(false);
    };

    return (
        <div className="data-history">
            <header className="history-header">
                <div className="history-heading">
                    <h2>Storico Dati</h2>
                    <p>{datedHistory.length} {datedHistory.length === 1 ? 'giorno registrato' : 'giorni registrati'}</p>
                </div>
                <button
                    className="history-period-button"
                    type="button"
                    aria-expanded={periodOpen}
                    aria-controls="data-history-period-picker"
                    onClick={() => {
                        setPeriodOpen(open => !open);
                        setPickerYear(Number(viewMonth.slice(0, 4)));
                    }}
                >
                    <CalendarRange size={18} aria-hidden="true" />
                    <span>Mese e anno</span>
                </button>
            </header>

            {periodOpen && (
                <section
                    className="history-year-picker"
                    id="data-history-period-picker"
                    aria-label="Scegli mese e anno"
                >
                    <div className="history-year-picker-head">
                        <button
                            className="history-icon-button"
                            type="button"
                            aria-label="Anno precedente"
                            onClick={() => setPickerYear(year => year - 1)}
                        >
                            <ChevronLeft size={20} aria-hidden="true" />
                        </button>
                        <strong>{pickerYear}</strong>
                        <button
                            className="history-icon-button"
                            type="button"
                            aria-label="Anno successivo"
                            onClick={() => setPickerYear(year => year + 1)}
                        >
                            <ChevronRight size={20} aria-hidden="true" />
                        </button>
                    </div>
                    <div className="history-year-picker-grid">
                        {MONTH_NAMES.map((name, index) => {
                            const key = `${pickerYear}-${pad(index + 1)}`;
                            const hasData = daysByMonth.has(key);
                            const selected = key === viewMonth;
                            return (
                                <button
                                    key={key}
                                    className={[
                                        'history-month-button',
                                        hasData ? 'has-data' : '',
                                        selected ? 'selected' : '',
                                    ].filter(Boolean).join(' ')}
                                    type="button"
                                    aria-pressed={selected}
                                    aria-label={`${name} ${pickerYear}${hasData ? ', contiene dati' : ''}`}
                                    onClick={() => selectMonth(key)}
                                >
                                    {name}
                                </button>
                            );
                        })}
                    </div>
                </section>
            )}

            <section className="history-calendar-panel" aria-label={`Calendario ${monthLabel(viewMonth)}`}>
                <div className="history-month-nav">
                    <button className="history-icon-button" type="button" aria-label="Mese precedente" onClick={() => changeMonth(-1)}>
                        <ChevronLeft size={20} aria-hidden="true" />
                    </button>
                    <strong className="history-month-name">{monthLabel(viewMonth)}</strong>
                    <button className="history-today-button" type="button" onClick={selectToday}>Oggi</button>
                    <button className="history-icon-button" type="button" aria-label="Mese successivo" onClick={() => changeMonth(1)}>
                        <ChevronRight size={20} aria-hidden="true" />
                    </button>
                </div>

                <div className="history-weekdays" aria-hidden="true">
                    <span>L</span><span>M</span><span>M</span><span>G</span><span>V</span><span>S</span><span>D</span>
                </div>

                <div className="history-calendar-grid">
                    {calendarDays.map(day => {
                        const count = daysByDate.get(day.dateStr)?.length || 0;
                        const selected = day.dateStr === selectedDate;
                        const isToday = day.dateStr === today;
                        return (
                            <button
                                key={day.dateStr}
                                className={[
                                    'history-day',
                                    day.isCurrentMonth ? '' : 'outside',
                                    isToday ? 'today' : '',
                                    selected ? 'selected' : '',
                                    count ? 'has-data' : '',
                                    count > 1 ? 'has-multiple' : '',
                                ].filter(Boolean).join(' ')}
                                type="button"
                                aria-pressed={selected}
                                aria-label={`${dayLabel(day.dateStr)}${count ? `, ${count} ${count === 1 ? 'rilevazione' : 'rilevazioni'}` : ''}`}
                                onClick={() => {
                                    setSelectedDate(day.dateStr);
                                    if (!day.isCurrentMonth) setViewMonth(day.dateStr.slice(0, 7));
                                }}
                            >
                                <span>{day.dayNum}</span>
                                {count > 1 && <span className="history-day-count" aria-hidden="true">{count}</span>}
                            </button>
                        );
                    })}
                </div>
            </section>

            <section className="history-month-summary" aria-label="Riepilogo del mese">
                <div>
                    <strong>{monthDays.length}</strong>
                    <span>Giorni con dati</span>
                </div>
                <div>
                    <strong>{averageWeight === null ? '—' : `${formatDecimal(averageWeight)} kg`}</strong>
                    <span>Peso medio</span>
                </div>
                <div>
                    <strong>{averageBf === null ? '—' : `${formatDecimal(averageBf)}%`}</strong>
                    <span>BF media</span>
                </div>
            </section>

            <section className="history-selected-day" aria-labelledby="data-history-selected-date">
                <div className="history-selected-day-heading">
                    <div>
                        <p>Giorno selezionato</p>
                        <h3 id="data-history-selected-date">{dayLabel(selectedDate)}</h3>
                    </div>
                    <span>{selectedDays.length} {selectedDays.length === 1 ? 'rilevazione' : 'rilevazioni'}</span>
                </div>

                {selectedDays.length === 0 ? (
                    <div className="history-empty-day">Nessun dato registrato in questo giorno.</div>
                ) : (
                    <div className="history-record-list">
                        {selectedDays.map((day, index) => {
                            const measurement = hasMeasurementData(day);
                            const title = measurement
                                ? `Misurazione${day.measurementTime ? ` · ${day.measurementTime}` : ''}`
                                : 'Dati giornalieri';
                            return (
                                <article
                                    className={`history-record-card${editingDate === day.date ? ' editing' : ''}`}
                                    key={`${day.date}-${day.measurementTime || index}`}
                                >
                                    <button
                                        className="history-record-open"
                                        type="button"
                                        aria-label={`Apri dettaglio del ${Logic.formatItalianDate(day.date)}`}
                                        onClick={() => setDetailDay(day)}
                                    >
                                        <span className="history-record-icon" aria-hidden="true"><Ruler size={20} /></span>
                                        <span className="history-record-copy">
                                            <span className="history-record-name">{title}</span>
                                            <span className="history-record-info">{recordSummary(day)}</span>
                                        </span>
                                        <ChevronRight size={18} aria-hidden="true" />
                                    </button>
                                    <div className="history-record-menu">
                                        <ContextMenu
                                            items={[
                                                {
                                                    label: 'Vedi dettaglio',
                                                    icon: <Ruler size={16} />,
                                                    onClick: event => {
                                                        // The menu item unmounts; retain its surviving trigger for modal focus restoration.
                                                        event.currentTarget.closest('.history-record-card')
                                                            ?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')
                                                            ?.focus({ preventScroll: true });
                                                        setDetailDay(day);
                                                    },
                                                },
                                                {
                                                    label: 'Modifica misurazione',
                                                    icon: <Pencil size={16} />,
                                                    hidden: !measurement,
                                                    onClick: () => onSelectEdit(day),
                                                },
                                                {
                                                    label: 'Elimina misurazione',
                                                    icon: <Trash2 size={16} />,
                                                    variant: 'danger',
                                                    hidden: !measurement || !onDeleteMeasurement,
                                                    onClick: () => onDeleteMeasurement?.(day.date),
                                                },
                                            ]}
                                        />
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                )}
            </section>

            {detailDay && (
                <DataHistoryDetail day={detailDay} onClose={() => setDetailDay(null)} onSelectEdit={onSelectEdit} />
            )}
        </div>
    );
};

export default DataHistory;
