import { Logic } from '../../../lib/logic';
import { getDateNavigatorState } from '../../../lib/utils/dateNavigator';

interface NutritionDateNavigatorProps {
    targetDateStr: string;
    onPrevious: () => void;
    onNext: () => void;
    onToday: () => void;
}

export function NutritionDateNavigator({
    targetDateStr,
    onPrevious,
    onNext,
    onToday,
}: NutritionDateNavigatorProps) {
    const today = Logic.getLocalDateString();
    const { isToday, formattedDate, nextDisabled } = getDateNavigatorState(targetDateStr, today);

    return (
        <div className="tracking-day">
            <button type="button" className="btn btn-secondary tracking-day-arrow" onClick={onPrevious} aria-label="Giorno precedente">‹ <span>Prec.</span></button>
            <button type="button" className="tracking-day-current" onClick={onToday} title="Torna a oggi">
                <strong>
                    {formattedDate}
                </strong>
                {isToday && (
                    <span className="text-sm tracking-accent">Oggi</span>
                )}
            </button>
            <button type="button" className="btn btn-secondary tracking-day-arrow" onClick={onNext} disabled={nextDisabled} aria-label="Giorno successivo"><span>Succ.</span> ›</button>
        </div>
    );
}
