import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Logic } from '../../lib/logic';

interface DataDateNavigatorProps {
    date: string;
    today: string;
    onPrevious: () => void;
    onNext: () => void;
    onToday: () => void;
    disabled?: boolean;
    label?: string;
}

export default function DataDateNavigator({
    date,
    today,
    onPrevious,
    onNext,
    onToday,
    disabled = false,
    label = 'Giorno selezionato',
}: DataDateNavigatorProps) {
    const isToday = date === today;

    return (
        <nav className="data-date-nav" aria-label={label}>
            <button
                type="button"
                className="data-date-arrow"
                onClick={onPrevious}
                disabled={disabled}
                aria-label="Giorno precedente"
            >
                <ChevronLeft size={20} aria-hidden="true" />
            </button>
            <button
                type="button"
                className="data-date-current"
                onClick={onToday}
                disabled={disabled}
                aria-label="Torna a oggi"
            >
                <strong>{Logic.formatItalianDate(date)}</strong>
                {isToday && <span>OGGI</span>}
            </button>
            <button
                type="button"
                className="data-date-arrow"
                onClick={onNext}
                disabled={disabled || isToday}
                aria-label="Giorno successivo"
            >
                <ChevronRight size={20} aria-hidden="true" />
            </button>
        </nav>
    );
}
