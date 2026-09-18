import { Logic } from '../../lib/logic';
import './TrackingViews.css';

interface DayNavigatorProps {
    date: string;
    today: string;
    onPrevious: () => void;
    onNext: () => void;
    onToday: () => void;
}

export function DayNavigator({ date, today, onPrevious, onNext, onToday }: DayNavigatorProps) {
    return (
        <nav className="tracking-day" aria-label="Seleziona giorno">
            <button type="button" className="btn btn-secondary tracking-day-arrow" aria-label="Giorno precedente" onClick={onPrevious}>◀ Prec.</button>
            <button type="button" className="tracking-day-current" onClick={onToday} title="Torna a oggi" aria-label={`${Logic.formatItalianDate(date)}. Torna a oggi`}>
                <span className="text-base font-semibold">{Logic.formatItalianDate(date)}</span>
                <span className="text-sm tracking-accent">{date === today ? 'Oggi' : 'Torna a oggi'}</span>
            </button>
            <button type="button" className="btn btn-secondary tracking-day-arrow" aria-label="Giorno successivo" onClick={onNext} disabled={date === today}>Succ. ▶</button>
        </nav>
    );
}
