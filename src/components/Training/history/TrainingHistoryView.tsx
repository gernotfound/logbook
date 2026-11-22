import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocalToday } from '../../../hooks/useLocalToday';
import { Logic } from '../../../lib/logic';
import { getWorkoutDurationSeconds } from '../../../lib/calc/workoutDuration';
import type { WorkoutSession } from '../../../types';
import { dayLabel } from '../../../lib/utils/historyCalendar';
import { formatCompactDuration, workoutDateKey } from './historyWorkoutPresentation';
import { HistoryWorkoutCard } from './HistoryWorkoutCard';
import { HistoryMonthCalendar, HistoryPeriodButton, HistoryPeriodPicker } from '../../UI/HistoryCalendar';

interface TrainingHistoryViewProps {
    history: WorkoutSession[];
    onEditWorkout?: (workout: WorkoutSession) => void;
    onDeleteWorkout?: (id: string) => Promise<void> | void;
    renderReport: (workout: WorkoutSession, onClose: () => void) => ReactNode;
}

interface DatedWorkout {
    workout: WorkoutSession;
    date: string;
}

export function TrainingHistoryView({
    history, onEditWorkout, onDeleteWorkout, renderReport,
}: TrainingHistoryViewProps) {
    const [selectedReportWorkout, setSelectedReportWorkout] = useState<WorkoutSession | null>(null);
    const currentReportWorkout = selectedReportWorkout
        ? history.find(workout => selectedReportWorkout.id
            ? workout.id === selectedReportWorkout.id
            : workout === selectedReportWorkout)
        : undefined;

    const today = useLocalToday();
    const datedHistory = useMemo<DatedWorkout[]>(() => history
        .map(workout => ({ workout, date: workoutDateKey(workout) }))
        .filter((entry): entry is DatedWorkout => Boolean(entry.date))
        .sort((a, b) => (
            b.date.localeCompare(a.date)
            || (b.workout.globalStartTime || 0) - (a.workout.globalStartTime || 0)
        )), [history]);
    const initialHistoryDate = datedHistory[0]?.date || today;

    const [viewMonth, setViewMonth] = useState(() => initialHistoryDate.slice(0, 7));
    const [selectedDate, setSelectedDate] = useState(() => initialHistoryDate);
    const [periodOpen, setPeriodOpen] = useState(false);
    const [pickerYear, setPickerYear] = useState(() => Number(initialHistoryDate.slice(0, 4)));
    const adoptedInitialHistory = useRef(datedHistory.length > 0);

    useEffect(() => {
        if (adoptedInitialHistory.current || datedHistory.length === 0) return;
        const latestDate = datedHistory[0].date;
        setSelectedDate(latestDate);
        setViewMonth(latestDate.slice(0, 7));
        setPickerYear(Number(latestDate.slice(0, 4)));
        adoptedInitialHistory.current = true;
    }, [datedHistory]);

    const { workoutsByDate, workoutsByMonth } = useMemo(() => {
        const workoutsByDate = new Map<string, WorkoutSession[]>();
        const workoutsByMonth = new Map<string, DatedWorkout[]>();
        for (const entry of datedHistory) {
            const currentDay = workoutsByDate.get(entry.date);
            if (currentDay) currentDay.push(entry.workout);
            else workoutsByDate.set(entry.date, [entry.workout]);

            const month = entry.date.slice(0, 7);
            const currentMonth = workoutsByMonth.get(month);
            if (currentMonth) currentMonth.push(entry);
            else workoutsByMonth.set(month, [entry]);
        }
        return { workoutsByDate, workoutsByMonth };
    }, [datedHistory]);

    const monthWorkouts = workoutsByMonth.get(viewMonth) || [];
    const selectedWorkouts = workoutsByDate.get(selectedDate) || [];
    const totalMonthSeconds = monthWorkouts.reduce(
        (sum, entry) => sum + (getWorkoutDurationSeconds(entry.workout) ?? 0),
        0
    );
    const [viewYear, viewMonthNumber] = viewMonth.split('-').map(Number);
    const daysInMonth = new Date(viewYear, viewMonthNumber, 0, 12, 0, 0).getDate();
    const weeklyAverage = monthWorkouts.length / (daysInMonth / 7);

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
            {currentReportWorkout && renderReport(currentReportWorkout, () => setSelectedReportWorkout(null))}

            <header className="history-header">
                <div className="history-heading">
                    <h2>Storico allenamenti</h2>
                    <p>{datedHistory.length} {datedHistory.length === 1 ? 'sessione registrata' : 'sessioni registrate'}</p>
                </div>
                <HistoryPeriodButton
                    pickerId="history-period-picker"
                    open={periodOpen}
                    onClick={togglePeriodPicker}
                />
            </header>

            {periodOpen && (
                <HistoryPeriodPicker
                    pickerId="history-period-picker"
                    year={pickerYear}
                    selectedMonth={viewMonth}
                    entriesByMonth={workoutsByMonth}
                    populatedClass="has-workout"
                    populatedDescription="allenamenti"
                    onChangeYear={delta => setPickerYear(year => year + delta)}
                    onSelectMonth={selectMonth}
                />
            )}
            <HistoryMonthCalendar
                month={viewMonth}
                selectedDate={selectedDate}
                today={today}
                entriesByDate={workoutsByDate}
                populatedClass="has-workout"
                itemSingular="allenamento"
                itemPlural="allenamenti"
                onChangeMonth={changeMonth}
                onSelectToday={selectToday}
                onSelectDate={(date, isCurrentMonth) => {
                    setSelectedDate(date);
                    if (!isCurrentMonth) setViewMonth(date.slice(0, 7));
                }}
            />

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
                        {selectedWorkouts.map((workout, index) => (
                            <HistoryWorkoutCard
                                key={workout.id || `${selectedDate}-${index}`}
                                workout={workout}
                                onOpen={setSelectedReportWorkout}
                                onEditWorkout={onEditWorkout}
                                onDeleteWorkout={onDeleteWorkout}
                            />
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}

