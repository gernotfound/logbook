import { Logic } from '../../../lib/logic';

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
    const isToday = targetDateStr === today;

    return (
        <div className="tracking-day">
            <button type="button" className="btn btn-secondary tracking-day-arrow" onClick={onPrevious} aria-label="Giorno precedente">‹ <span>Prec.</span></button>
            <button type="button" className="tracking-day-current" onClick={onToday} title="Torna a oggi">
                <strong>
                    {Logic.formatItalianDate ? Logic.formatItalianDate(targetDateStr) : targetDateStr}
                </strong>
                {isToday && (
                    <span className="text-sm tracking-accent">Oggi</span>
                )}
            </button>
            <button type="button" className="btn btn-secondary tracking-day-arrow" onClick={onNext} disabled={isToday} aria-label="Giorno successivo"><span>Succ.</span> ›</button>
        </div>
    );
}
