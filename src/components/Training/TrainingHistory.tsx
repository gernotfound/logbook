import { useEffect, useMemo, useRef, useState } from 'react';
import {
    BarChart2,
    CalendarRange,
    ChevronLeft,
    ChevronRight,
    Dumbbell,
    Pencil,
    Trash2,
} from 'lucide-react';
import { ContextMenu } from '../UI/ContextMenu';
import { useTrainingHistory } from '../../hooks/useTrainingHistory';
import { Logic } from '../../lib/logic';
import type { WorkoutSession } from '../../types';
import WorkoutReportModal from './WorkoutReportModal';

interface TrainingHistoryProps {
    onEditWorkout?: (workout: WorkoutSession) => void;
}

interface DatedWorkout {
    workout: WorkoutSession;
    date: string;
}

const MONTH_NAMES = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

function workoutDateKey(workout: WorkoutSession): string | null {
    const explicitDate = workout.date ? Logic.parseDateInput(workout.date) : null;
    if (explicitDate) return explicitDate;
    if (typeof workout.globalStartTime === 'number' && Number.isFinite(workout.globalStartTime)) {
        return Logic.getLocalDateString(workout.globalStartTime);
    }
    return null;
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

function durationSeconds(workout: WorkoutSession): number {
    if (
        typeof workout.globalStartTime === 'number'
        && Number.isFinite(workout.globalStartTime)
        && typeof workout.globalEndTime === 'number'
        && Number.isFinite(workout.globalEndTime)
    ) {
        return Math.max(0, Math.floor((workout.globalEndTime - workout.globalStartTime) / 1000));
    }

    const normalized = Logic.normalizeDuration(workout.manualDurationStr || workout.globalDurationStr || '');
    const [hours = 0, minutes = 0, seconds = 0] = normalized.split(':').map(Number);
    if (![hours, minutes, seconds].every(Number.isFinite)) return 0;
    return Math.max(0, hours * 3600 + minutes * 60 + seconds);
}

function formatCompactDuration(seconds: number): string {
    const totalMinutes = Math.max(0, Math.round(seconds / 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) return `${hours} h${minutes ? ` ${minutes} min` : ''}`;
    return `${totalMinutes} min`;
}

function workoutStartTime(workout: WorkoutSession): string {
    if (typeof workout.globalStartTime !== 'number' || !Number.isFinite(workout.globalStartTime)) {
        return 'Orario n.d.';
    }
    return new Intl.DateTimeFormat('it-IT', {
        hour: '2-digit',
        minute: '2-digit',
    }).format(new Date(workout.globalStartTime));
}

const TrainingHistory = ({ onEditWorkout }: TrainingHistoryProps) => {
    const { userData, history, deleteWorkout } = useTrainingHistory();
    const [selectedReportWorkout, setSelectedReportWorkout] = useState<WorkoutSession | null>(null);

    const library = useMemo(() => userData?.library || [], [userData?.library]);
    const today = Logic.getLocalDateString();
    const initialHistoryDate = useMemo(() => {
        const dates = history
            .map(workoutDateKey)
            .filter((date): date is string => Boolean(date))
            .sort((a, b) => b.localeCompare(a));
        return dates[0] || today;
    }, [history, today]);

    const [viewMonth, setViewMonth] = useState(() => initialHistoryDate.slice(0, 7));
    const [selectedDate, setSelectedDate] = useState(() => initialHistoryDate);
    const [periodOpen, setPeriodOpen] = useState(false);
    const [pickerYear, setPickerYear] = useState(() => Number(initialHistoryDate.slice(0, 4)));
    const adoptedInitialHistory = useRef(history.some(workout => workoutDateKey(workout) !== null));

    const datedHistory = useMemo<DatedWorkout[]>(() => history
        .map(workout => ({ workout, date: workoutDateKey(workout) }))
        .filter((entry): entry is DatedWorkout => Boolean(entry.date))
        .sort((a, b) => (
            b.date.localeCompare(a.date)
            || (b.workout.globalStartTime || 0) - (a.workout.globalStartTime || 0)
        )), [history]);

    useEffect(() => {
        if (adoptedInitialHistory.current || datedHistory.length === 0) return;
        const latestDate = datedHistory[0].date;
        setSelectedDate(latestDate);
        setViewMonth(latestDate.slice(0, 7));
        setPickerYear(Number(latestDate.slice(0, 4)));
        adoptedInitialHistory.current = true;
    }, [datedHistory]);

    const workoutsByDate = useMemo(() => {
        const map = new Map<string, WorkoutSession[]>();
        datedHistory.forEach(({ workout, date }) => {
            const current = map.get(date);
            if (current) current.push(workout);
            else map.set(date, [workout]);
        });
        return map;
    }, [datedHistory]);

    const workoutsByMonth = useMemo(() => {
        const map = new Map<string, DatedWorkout[]>();
        datedHistory.forEach(entry => {
            const key = entry.date.slice(0, 7);
            const current = map.get(key);
            if (current) current.push(entry);
            else map.set(key, [entry]);
        });
        return map;
    }, [datedHistory]);

    const monthWorkouts = workoutsByMonth.get(viewMonth) || [];
    const selectedWorkouts = workoutsByDate.get(selectedDate) || [];
    const totalMonthSeconds = monthWorkouts.reduce(
        (sum, entry) => sum + durationSeconds(entry.workout),
        0
    );
    const [viewYear, viewMonthNumber] = viewMonth.split('-').map(Number);
    const daysInMonth = new Date(viewYear, viewMonthNumber, 0, 12, 0, 0).getDate();
    const weeklyAverage = monthWorkouts.length / (daysInMonth / 7);
    const calendarDays = Logic.getCalendarMonthGrid(viewYear, viewMonthNumber - 1);

    const selectMonth = (month: string) => {
        setViewMonth(month);
        const workouts = workoutsByMonth.get(month);
        setSelectedDate(workouts?.[0]?.date || `${month}-01`);
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

    const togglePeriodPicker = () => {
        setPeriodOpen(current => {
            const next = !current;
            if (next) setPickerYear(Number(viewMonth.slice(0, 4)));
            return next;
        });
    };

    return (
        <div className="training-sub-view active training-history">
            {selectedReportWorkout && (
                <WorkoutReportModal
                    workout={selectedReportWorkout}
                    history={history}
                    library={library}
                    onClose={() => setSelectedReportWorkout(null)}
                    fromEndWorkout={false}
                />
            )}

            <header className="history-header">
                <div className="history-heading">
                    <h2>Storico allenamenti</h2>
                    <p>{datedHistory.length} {datedHistory.length === 1 ? 'sessione registrata' : 'sessioni registrate'}</p>
                </div>
                <button
                    className="history-period-button"
                    type="button"
                    aria-expanded={periodOpen}
                    aria-controls="history-period-picker"
                    onClick={togglePeriodPicker}
                >
                    <CalendarRange size={18} aria-hidden="true" />
                    <span>Mese e anno</span>
                </button>
            </header>

            {periodOpen && (
                <section
                    className="history-year-picker"
                    id="history-period-picker"
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
                            const hasWorkout = workoutsByMonth.has(key);
                            const selected = key === viewMonth;
                            return (
                                <button
                                    key={key}
                                    className={[
                                        'history-month-button',
                                        hasWorkout ? 'has-workout' : '',
                                        selected ? 'selected' : '',
                                    ].filter(Boolean).join(' ')}
                                    type="button"
                                    aria-pressed={selected}
                                    aria-label={`${name} ${pickerYear}${hasWorkout ? ', contiene allenamenti' : ''}`}
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
                    <button
                        className="history-icon-button"
                        type="button"
                        aria-label="Mese precedente"
                        onClick={() => changeMonth(-1)}
                    >
                        <ChevronLeft size={20} aria-hidden="true" />
                    </button>
                    <strong className="history-month-name">{monthLabel(viewMonth)}</strong>
                    <button
                        className="history-today-button"
                        type="button"
                        onClick={selectToday}
                    >
                        Oggi
                    </button>
                    <button
                        className="history-icon-button"
                        type="button"
                        aria-label="Mese successivo"
                        onClick={() => changeMonth(1)}
                    >
                        <ChevronRight size={20} aria-hidden="true" />
                    </button>
                </div>

                <div className="history-weekdays" aria-hidden="true">
                    <span>L</span><span>M</span><span>M</span><span>G</span><span>V</span><span>S</span><span>D</span>
                </div>

                <div className="history-calendar-grid">
                    {calendarDays.map(day => {
                        const count = workoutsByDate.get(day.dateStr)?.length || 0;
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
                                    count ? 'has-workout' : '',
                                    count > 1 ? 'has-multiple' : '',
                                ].filter(Boolean).join(' ')}
                                type="button"
                                aria-pressed={selected}
                                aria-label={`${dayLabel(day.dateStr)}${count ? `, ${count} ${count === 1 ? 'allenamento' : 'allenamenti'}` : ''}`}
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
                    <strong>{monthWorkouts.length}</strong>
                    <span>Allenamenti</span>
                </div>
                <div>
                    <strong>{formatCompactDuration(totalMonthSeconds)}</strong>
                    <span>Tempo totale</span>
                </div>
                <div>
                    <strong>{weeklyAverage.toLocaleString('it-IT', { maximumFractionDigits: 1 })}×</strong>
                    <span>Media sett.</span>
                </div>
            </section>

            <section className="history-selected-day" aria-labelledby="history-selected-date">
                <div className="history-selected-day-heading">
                    <div>
                        <p>Giorno selezionato</p>
                        <h3 id="history-selected-date">{dayLabel(selectedDate)}</h3>
                    </div>
                    <span>{selectedWorkouts.length} {selectedWorkouts.length === 1 ? 'sessione' : 'sessioni'}</span>
                </div>

                {selectedWorkouts.length === 0 ? (
                    <div className="history-empty-day">Nessun allenamento in questo giorno.</div>
                ) : (
                    <div className="history-workout-list">
                        {selectedWorkouts.map((workout, index) => {
                            const name = workout.routineName || 'Sessione personalizzata';
                            const exerciseCount = workout.exercises?.length || 0;
                            const info = `${workoutStartTime(workout)} · ${formatCompactDuration(durationSeconds(workout))} · ${exerciseCount} ${exerciseCount === 1 ? 'esercizio' : 'esercizi'}`;
                            return (
                                <article
                                    className="history-workout-card"
                                    key={workout.id || `${selectedDate}-${index}`}
                                >
                                    <button
                                        className="history-workout-open"
                                        type="button"
                                        aria-label={`Apri il dettaglio di ${name}`}
                                        onClick={() => setSelectedReportWorkout(workout)}
                                    >
                                        <span className="history-workout-icon">
                                            <Dumbbell size={20} aria-hidden="true" />
                                        </span>
                                        <span className="history-workout-copy">
                                            <span className="history-workout-name" title={name}>{name}</span>
                                            <span className="history-workout-info">{info}</span>
                                        </span>
                                        <ChevronRight className="history-workout-chevron" size={18} aria-hidden="true" />
                                    </button>
                                    <div className="history-workout-menu">
                                        <ContextMenu
                                            items={[
                                                {
                                                    label: 'Vedi report',
                                                    icon: <BarChart2 size={16} />,
                                                    onClick: () => setSelectedReportWorkout(workout)
                                                },
                                                {
                                                    label: 'Modifica allenamento',
                                                    icon: <Pencil size={16} />,
                                                    hidden: !onEditWorkout,
                                                    onClick: () => onEditWorkout?.(workout)
                                                },
                                                {
                                                    label: 'Elimina allenamento',
                                                    icon: <Trash2 size={16} />,
                                                    variant: 'danger',
                                                    hidden: !workout.id,
                                                    onClick: () => workout.id && deleteWorkout(workout.id)
                                                }
                                            ]}
                                        />
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                )}
            </section>
        </div>
    );
};

export default TrainingHistory;
