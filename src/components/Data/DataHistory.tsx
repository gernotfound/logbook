import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocalToday } from '../../hooks/useLocalToday';
import { ChevronRight, Pencil, Ruler, Trash2 } from 'lucide-react';
import { Logic } from '../../lib/logic';
import { ContextMenu } from '../UI/ContextMenu';
import type { MeasurementHistoryDay } from '../../types';
import DataHistoryDetail from './DataHistoryDetail';
import { hasMeasurementData, finiteAverage, formatDecimal, recordSummary } from './dataHistoryFormatting';
import { dayLabel } from '../../lib/utils/historyCalendar';
import { HistoryMonthCalendar, HistoryPeriodButton, HistoryPeriodPicker } from '../UI/HistoryCalendar';

interface DataHistoryProps {
    measurementsHistory: MeasurementHistoryDay[];
    editingDate: string | null;
    onSelectEdit: (day: MeasurementHistoryDay) => void;
    onDeleteMeasurement?: (date: string) => void;
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

    const currentDetailDay = useMemo(() => {
        if (!detailDay) return null;
        const records = daysByDate.get(detailDay.date) ?? [];
        // The supported store has one day record per date. If a caller supplies
        // multiple records without stable IDs, never silently switch the dialog
        // to a different record after a concurrent refresh.
        if (records.includes(detailDay)) return detailDay;
        const matches = records.filter(day => day.measurementTime === detailDay.measurementTime);
        return matches.length === 1 ? matches[0] : null;
    }, [daysByDate, detailDay]);

    useEffect(() => {
        // A dismissed source record must not reopen its old dialog if a later
        // hydration or sync introduces a matching date again.
        if (detailDay && !currentDetailDay) setDetailDay(null);
    }, [detailDay, currentDetailDay]);

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
                <HistoryPeriodButton
                    pickerId="data-history-period-picker"
                    open={periodOpen}
                    onClick={() => {
                        setPeriodOpen(open => !open);
                        setPickerYear(Number(viewMonth.slice(0, 4)));
                    }}
                />
            </header>

            {periodOpen && (
                <HistoryPeriodPicker
                    pickerId="data-history-period-picker"
                    year={pickerYear}
                    selectedMonth={viewMonth}
                    entriesByMonth={daysByMonth}
                    populatedClass="has-data"
                    populatedDescription="dati"
                    onChangeYear={delta => setPickerYear(year => year + delta)}
                    onSelectMonth={selectMonth}
                />
            )}
            <HistoryMonthCalendar
                month={viewMonth}
                selectedDate={selectedDate}
                today={today}
                entriesByDate={daysByDate}
                populatedClass="has-data"
                itemSingular="rilevazione"
                itemPlural="rilevazioni"
                onChangeMonth={changeMonth}
                onSelectToday={selectToday}
                onSelectDate={(date, isCurrentMonth) => {
                    setSelectedDate(date);
                    if (!isCurrentMonth) setViewMonth(date.slice(0, 7));
                }}
            />

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

            {currentDetailDay && (
                <DataHistoryDetail day={currentDetailDay} onClose={() => setDetailDay(null)} onSelectEdit={onSelectEdit} />
            )}
        </div>
    );
};

export default DataHistory;
