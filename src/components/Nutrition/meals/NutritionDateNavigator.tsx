import { useLocalToday } from '../../../hooks/useLocalToday';
import { shiftDateString } from '../../../lib/utils/date';
import { getDateNavigatorState } from '../../../lib/utils/dateNavigator';

interface NutritionDateNavigatorProps {
    targetDateStr: string;
    setSelectedDate: (date: string) => void;
}

export function NutritionDateNavigator({
    targetDateStr,
    setSelectedDate,
}: NutritionDateNavigatorProps) {
    const today = useLocalToday();
    const { isToday, formattedDate, nextDisabled } = getDateNavigatorState(targetDateStr, today);

    const handleNextDay = () => {
        if (!nextDisabled) setSelectedDate(shiftDateString(targetDateStr, 1));
    };

    return (
        <div className="tracking-day">
            <button
                type="button"
                className="btn btn-secondary tracking-day-arrow"
                onClick={() => setSelectedDate(shiftDateString(targetDateStr, -1))}
                aria-label="Prec. Giorno precedente"
            >
                <span aria-hidden="true">‹</span> <span>Prec.</span>
            </button>
            <button
                type="button"
                className="tracking-day-current"
                onClick={() => setSelectedDate(today)}
                title="Torna a oggi"
                aria-label={`${formattedDate}${isToday ? ' Oggi' : ''}. Torna a oggi`}
            >
                <strong>{formattedDate}</strong>{' '}
                {isToday && <span className="text-sm tracking-accent">Oggi</span>}
            </button>
            <button
                type="button"
                className="btn btn-secondary tracking-day-arrow"
                onClick={handleNextDay}
                disabled={nextDisabled}
                aria-label="Succ. Giorno successivo"
            >
                <span>Succ.</span> <span aria-hidden="true">›</span>
            </button>
        </div>
    );
}
