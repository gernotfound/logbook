import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocalToday } from '../../hooks/useLocalToday';
import { Logic } from '../../lib/logic';
import type { MeasurementHistoryDay } from '../../types';
import DataHistoryRecordCard from './DataHistoryRecordCard';
import { finiteAverage, formatDecimal } from './dataHistoryFormatting';
import { dayLabel } from '../../lib/utils/historyCalendar';
import { HistoryMonthCalendar, HistoryPeriodButton, HistoryPeriodPicker } from '../UI/HistoryCalendar';

interface DataHistoryProps {
    measurementsHistory: MeasurementHistoryDay[];
    editingDate: string | null;
    onSelectEdit?: (day: MeasurementHistoryDay) => void;
    onDeleteMeasurement?: (date: string) => void;
}

const DataHistory: React.FC<DataHistoryProps> = ({
    measurementsHistory,
    editingDate,
    onSelectEdit,
    onDeleteMeasurement,
}) => {
    const today = useLocalToday();
    const periodPickerId = useId();
    const selectedDateHeadingId = useId();
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
                    pickerId={periodPickerId}
                    open={periodOpen}
                    onClick={() => {
                        setPeriodOpen(open => !open);
                        setPickerYear(Number(viewMonth.slice(0, 4)));
                    }}
                />
            </header>

            {periodOpen && (
                <HistoryPeriodPicker
                    pickerId={periodPickerId}
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

            <section className="history-selected-day" aria-labelledby={selectedDateHeadingId}>
                <div className="history-selected-day-heading">
                    <div>
                        <p>Giorno selezionato</p>
                        <h3 id={selectedDateHeadingId}>{dayLabel(selectedDate)}</h3>
                    </div>
                    <span>{selectedDays.length} {selectedDays.length === 1 ? 'rilevazione' : 'rilevazioni'}</span>
                </div>

                {selectedDays.length === 0 ? (
                    <div className="history-empty-day">Nessun dato registrato in questo giorno.</div>
                ) : (
                    <div className="history-record-list">
                        {selectedDays.map((day, index) => {
                            const uniqueTime = selectedDays.length === 1
                                || selectedDays.filter(item => item.measurementTime === day.measurementTime).length === 1;
                            // In the authoritative NutritionDay map the date is unique.
                            // Only synthetic/malformed duplicates require an additional time key.
                            const recordKey = selectedDays.length === 1
                                ? day.date
                                : `${day.date}:${day.measurementTime ?? 'unspecified'}${uniqueTime ? '' : ':' + index}`;
                            return (
                                <DataHistoryRecordCard
                                    key={recordKey}
                                    day={day}
                                    editingDate={editingDate}
                                    canOpenDetail={uniqueTime}
                                    onSelectEdit={onSelectEdit}
                                    onDeleteMeasurement={onDeleteMeasurement}
                                />
                            );
                        })}
                    </div>
                )}
            </section>

        </div>
    );
};

export default DataHistory;
