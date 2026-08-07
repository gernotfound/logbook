import { 
    format, 
    isValid, 
    parseISO, 
    differenceInYears, 
    startOfMonth, 
    endOfMonth, 
    startOfWeek, 
    endOfWeek, 
    eachDayOfInterval, 
    isSameMonth, 
    isToday, 
    addDays 
} from 'date-fns';

export function generateId(prefix: string): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return prefix + '_' + crypto.randomUUID();
    }
    return prefix + '_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now().toString(36);
}

export function getLocalDateString(d: Date | string | number = new Date()): string {
    let date: Date;
    if (d instanceof Date) {
        date = d;
    } else if (typeof d === 'string') {
        date = d.includes('T') ? new Date(d) : parseISO(d);
        if (!isValid(date)) {
            date = new Date(d);
        }
    } else if (typeof d === 'number') {
        date = new Date(d);
    } else {
        date = new Date();
    }
    if (!isValid(date)) {
        return format(new Date(), 'yyyy-MM-dd');
    }
    return format(date, 'yyyy-MM-dd');
}

export function calculateAge(dob: string | Date | number): number {
    if (!dob) return 30;
    let date: Date;
    if (dob instanceof Date) {
        date = dob;
    } else if (typeof dob === 'string') {
        date = dob.includes('T') ? new Date(dob) : parseISO(dob);
        if (!isValid(date)) {
            date = new Date(dob);
        }
    } else if (typeof dob === 'number') {
        date = new Date(dob);
    } else {
        return 30;
    }
    if (!isValid(date)) return 30;
    const age = differenceInYears(new Date(), date);
    return isNaN(age) || age < 0 ? 30 : age;
}

export function formatDuration(secondsOrMs: number, isMs = false): string {
    const totalSec = Math.max(0, isMs ? Math.floor(secondsOrMs / 1000) : Math.floor(secondsOrMs));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const p = (n: number) => n.toString().padStart(2, '0');
    return `${p(h)}:${p(m)}:${p(s)}`;
}

export function normalizeDuration(input: string | undefined | null): string {
    if (!input || typeof input !== 'string' || !input.trim()) return '00:00:00';
    const cleaned = input.trim();
    
    // Riconosce formati con 'min' (es. '45 min', '75 min')
    if (/^\d+\s*min/i.test(cleaned)) {
        const m = parseInt(cleaned, 10) || 0;
        const h = Math.floor(m / 60);
        const remM = m % 60;
        const p = (n: number) => n.toString().padStart(2, '0');
        return `${p(h)}:${p(remM)}:00`;
    }

    const parts = cleaned.split(':').map(p => parseInt(p.trim(), 10) || 0);
    const p = (n: number) => n.toString().padStart(2, '0');

    if (parts.length >= 3) {
        const [h, m, s] = parts;
        return `${p(h)}:${p(m)}:${p(s)}`;
    }
    if (parts.length === 2) {
        const [m, s] = parts;
        const h = Math.floor(m / 60);
        const remM = m % 60;
        return `${p(h)}:${p(remM)}:${p(s)}`;
    }
    if (parts.length === 1) {
        const m = parts[0];
        const h = Math.floor(m / 60);
        const remM = m % 60;
        return `${p(h)}:${p(remM)}:00`;
    }
    return '00:00:00';
}

export function formatTime(ms: number, showHours = false): string {
    let totalSec = Math.floor(ms / 1000);
    let h = Math.floor(totalSec / 3600);
    let m = Math.floor((totalSec % 3600) / 60);
    let s = totalSec % 60;
    let p = (n: number) => n.toString().padStart(2, '0');
    return showHours ? `${p(h)}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

export function validateInputData(value: any, type: string) {
    if (value === '' || value === null) return '';
    if (type === 'int') {
        return value.toString().replace(/[^0-9]/g, '');
    } else if (type === 'float') {
        let val = value.toString().replace(/,/g, '.').replace(/[^0-9.]/g, '');
        const parts = val.split('.');
        if (parts.length > 2) {
            val = parts[0] + '.' + parts.slice(1).join('');
        }
        return val;
    }
    return value;
}

export interface CalendarDayCell {
    dayNum: number;
    dateStr: string;
    isCurrentMonth: boolean;
    isToday: boolean;
}

export function getCalendarMonthGrid(year: any, month: any): CalendarDayCell[] {
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    const targetMonth = new Date(y, m, 1);
    const monthStart = startOfMonth(targetMonth);
    const monthEnd = endOfMonth(targetMonth);
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    
    let days = eachDayOfInterval({ start: gridStart, end: gridEnd });
    
    // Ensure minimum 35 cells for UI consistency
    while (days.length < 35) {
        const lastDay = days[days.length - 1];
        const nextWeek = eachDayOfInterval({
            start: addDays(lastDay, 1),
            end: addDays(lastDay, 7)
        });
        days = days.concat(nextWeek);
    }

    return days.map(d => ({
        dayNum: d.getDate(),
        dateStr: format(d, 'yyyy-MM-dd'),
        isCurrentMonth: isSameMonth(d, monthStart),
        isToday: isToday(d)
    }));
}
