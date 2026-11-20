const MONTH_FORMATTER = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' });
const DAY_FORMATTER = new Intl.DateTimeFormat('it-IT', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
});

export const HISTORY_MONTH_NAMES = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'] as const;

export function historyMonthKey(year: number, month: number): string {
    return `${year}-${String(month).padStart(2, '0')}`;
}

export function monthLabel(key: string): string {
    const [year, month] = key.split('-').map(Number);
    const label = MONTH_FORMATTER.format(new Date(year, month - 1, 1, 12, 0, 0));
    return label.charAt(0).toUpperCase() + label.slice(1);
}

export function dayLabel(key: string): string {
    const [year, month, day] = key.split('-').map(Number);
    const label = DAY_FORMATTER.format(new Date(year, month - 1, day, 12, 0, 0));
    return label.charAt(0).toUpperCase() + label.slice(1);
}
