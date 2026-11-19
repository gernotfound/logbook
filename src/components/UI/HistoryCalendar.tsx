import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';
import { Logic } from '../../lib/logic';
import { HISTORY_MONTH_NAMES, dayLabel, historyMonthKey, monthLabel } from '../../lib/utils/historyCalendar';

interface HistoryPeriodButtonProps {
    pickerId: string;
    open: boolean;
    onClick: () => void;
}

export function HistoryPeriodButton({ pickerId, open, onClick }: HistoryPeriodButtonProps) {
    return (
        <button
            className="history-period-button"
            type="button"
            aria-expanded={open}
            aria-controls={pickerId}
            onClick={onClick}
        >
            <CalendarRange size={18} aria-hidden="true" />
            <span>Mese e anno</span>
        </button>
    );
}

interface HistoryPeriodPickerProps {
    pickerId: string;
    year: number;
    selectedMonth: string;
    entriesByMonth: ReadonlyMap<string, unknown>;
    populatedClass: string;
    populatedDescription: string;
    onChangeYear: (delta: number) => void;
    onSelectMonth: (month: string) => void;
}

export function HistoryPeriodPicker({
    pickerId, year, selectedMonth, entriesByMonth, populatedClass, populatedDescription,
    onChangeYear, onSelectMonth,
}: HistoryPeriodPickerProps) {
    return (
        <section className="history-year-picker" id={pickerId} aria-label="Scegli mese e anno">
            <div className="history-year-picker-head">
                <button
                    className="history-icon-button"
                    type="button"
                    aria-label="Anno precedente"
                    onClick={() => onChangeYear(-1)}
                >
                    <ChevronLeft size={20} aria-hidden="true" />
                </button>
                <strong>{year}</strong>
                <button
                    className="history-icon-button"
                    type="button"
                    aria-label="Anno successivo"
                    onClick={() => onChangeYear(1)}
                >
                    <ChevronRight size={20} aria-hidden="true" />
                </button>
            </div>
            <div className="history-year-picker-grid">
                {HISTORY_MONTH_NAMES.map((name, index) => {
                    const key = historyMonthKey(year, index + 1);
                    const populated = entriesByMonth.has(key);
                    const selected = key === selectedMonth;
                    return (
                        <button
                            key={key}
                            className={[
                                'history-month-button',
                                populated ? populatedClass : '',
                                selected ? 'selected' : '',
                            ].filter(Boolean).join(' ')}
                            type="button"
                            aria-pressed={selected}
                            aria-label={`${name} ${year}${populated ? `, contiene ${populatedDescription}` : ''}`}
                            onClick={() => onSelectMonth(key)}
                        >
                            {name}
                        </button>
                    );
                })}
            </div>
        </section>
    );
}

interface HistoryMonthCalendarProps {
    month: string;
    selectedDate: string;
    today: string;
    entriesByDate: ReadonlyMap<string, readonly unknown[]>;
    populatedClass: string;
    itemSingular: string;
    itemPlural: string;
    onChangeMonth: (delta: number) => void;
    onSelectToday: () => void;
    onSelectDate: (date: string, isCurrentMonth: boolean) => void;
}

export function HistoryMonthCalendar({
    month, selectedDate, today, entriesByDate, populatedClass, itemSingular, itemPlural,
    onChangeMonth, onSelectToday, onSelectDate,
}: HistoryMonthCalendarProps) {
    const [year, monthNumber] = month.split('-').map(Number);
    const calendarDays = Logic.getCalendarMonthGrid(year, monthNumber - 1);

    return (
        <section className="history-calendar-panel" aria-label={`Calendario ${monthLabel(month)}`}>
            <div className="history-month-nav">
                <button
                    className="history-icon-button"
                    type="button"
                    aria-label="Mese precedente"
                    onClick={() => onChangeMonth(-1)}
                >
                    <ChevronLeft size={20} aria-hidden="true" />
                </button>
                <strong className="history-month-name">{monthLabel(month)}</strong>
                <button className="history-today-button" type="button" onClick={onSelectToday}>Oggi</button>
                <button
                    className="history-icon-button"
                    type="button"
                    aria-label="Mese successivo"
                    onClick={() => onChangeMonth(1)}
                >
                    <ChevronRight size={20} aria-hidden="true" />
                </button>
            </div>
            <div className="history-weekdays" aria-hidden="true">
                <span>L</span><span>M</span><span>M</span><span>G</span><span>V</span><span>S</span><span>D</span>
            </div>
            <div className="history-calendar-grid">
                {calendarDays.map(day => {
                    const count = entriesByDate.get(day.dateStr)?.length || 0;
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
                                count ? populatedClass : '',
                                count > 1 ? 'has-multiple' : '',
                            ].filter(Boolean).join(' ')}
                            type="button"
                            aria-pressed={selected}
                            aria-label={`${dayLabel(day.dateStr)}${count ? `, ${count} ${count === 1 ? itemSingular : itemPlural}` : ''}`}
                            onClick={() => onSelectDate(day.dateStr, day.isCurrentMonth)}
                        >
                            <span>{day.dayNum}</span>
                            {count > 1 && <span className="history-day-count" aria-hidden="true">{count}</span>}
                        </button>
                    );
                })}
            </div>
        </section>
    );
}
