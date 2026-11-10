import { 
    format, 
    isValid, 
    parseISO, 
    startOfMonth, 
    endOfMonth, 
    startOfWeek, 
    endOfWeek, 
    eachDayOfInterval, 
    isSameMonth, 
    isToday, 
    addDays 
} from 'date-fns';

function randomUuidFromCrypto(webCrypto: Crypto): string {
    if (typeof webCrypto.randomUUID === 'function') return webCrypto.randomUUID();
    if (typeof webCrypto.getRandomValues !== 'function') {
        throw new Error('Generazione ID sicura non disponibile in questo ambiente.');
    }

    const bytes = webCrypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

export function generateId(prefix: string): string {
    const webCrypto = globalThis.crypto;
    if (!webCrypto) throw new Error('Generazione ID sicura non disponibile in questo ambiente.');
    return `${prefix}_${randomUuidFromCrypto(webCrypto)}`;
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

export function formatItalianDate(d: Date | string | number | undefined | null): string {
    if (d === undefined || d === null) return '';
    let date: Date;
    if (d instanceof Date) {
        date = d;
    } else if (typeof d === 'string') {
        const cleaned = d.trim();
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(cleaned)) {
            const [day, month, year] = cleaned.split('/');
            date = parseISO(`${year}-${month}-${day}`);
        } else {
            date = cleaned.includes('T') ? new Date(cleaned) : parseISO(cleaned);
            // Native parsing can roll an impossible calendar day into the next month.
            if (!isValid(date) && !/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
                date = new Date(cleaned);
            }
        }
    } else if (typeof d === 'number') {
        date = new Date(d);
    } else {
        return '';
    }
    if (!isValid(date)) return '';
    return format(date, 'dd/MM/yyyy');
}

export function parseDateInput(input: string | undefined | null): string | null {
    if (!input || typeof input !== 'string') return null;
    const trimmed = input.trim();
    if (!trimmed) return null;

    // Pattern YYYY-MM-DD
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(trimmed)) {
        const [y, m, d] = trimmed.split('-').map(Number);
        const dateObj = new Date(y, m - 1, d);
        if (isValid(dateObj) && dateObj.getFullYear() === y && dateObj.getMonth() === m - 1 && dateObj.getDate() === d) {
            return format(dateObj, 'yyyy-MM-dd');
        }
    }

    // Pattern DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
    const dmyMatch = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
    if (dmyMatch) {
        const day = parseInt(dmyMatch[1], 10);
        const month = parseInt(dmyMatch[2], 10);
        const year = parseInt(dmyMatch[3], 10);
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1900 && year <= 2100) {
            const dateObj = new Date(year, month - 1, day);
            if (isValid(dateObj) && dateObj.getFullYear() === year && dateObj.getMonth() === month - 1 && dateObj.getDate() === day) {
                return format(dateObj, 'yyyy-MM-dd');
            }
        }
    }

    return null;
}

/**
 * Shift a calendar date string (YYYY-MM-DD) by deltaDays in a timezone-safe manner.
 * Anchoring at local noon (12:00:00) prevents DST transitions and negative UTC offsets
 * from crossing midnight boundaries.
 */
export function shiftDateString(dateStr: string | undefined | null, deltaDays: number): string {
    const validStr = parseDateInput(dateStr) || getLocalDateString();
    const [y, m, d] = validStr.split('-').map(Number);
    const date = new Date(y, m - 1, d, 12, 0, 0);
    date.setDate(date.getDate() + deltaDays);
    return getLocalDateString(date);
}

export function formatDuration(secondsOrMs: number, isMs = false): string {
    const totalSec = Math.max(0, isMs ? Math.floor(secondsOrMs / 1000) : Math.floor(secondsOrMs));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const p = (n: number) => n.toString().padStart(2, '0');
    return `${p(h)}:${p(m)}:${p(s)}`;
}

/** Strict boundary for user-edited workout duration; unlike permissive normalization, invalid input stays invalid. */
export function parseManualDuration(input: string | undefined | null): string | null {
    const cleaned = input?.trim() ?? '';
    if (!cleaned) return '00:00:00';

    let totalSeconds: number;
    const minutesMatch = /^(\d+)\s*min$/i.exec(cleaned);
    if (minutesMatch) {
        const minutes = Number(minutesMatch[1]);
        if (!Number.isSafeInteger(minutes)) return null;
        totalSeconds = minutes * 60;
    } else {
        if (!/^\d+(?::\d+){0,2}$/.test(cleaned)) return null;
        const parts = cleaned.split(':').map(Number);
        if (parts.some(value => !Number.isSafeInteger(value))) return null;
        if (parts.length === 3) {
            if (parts[1] >= 60 || parts[2] >= 60) return null;
            totalSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
        } else if (parts.length === 2) {
            if (parts[1] >= 60) return null;
            totalSeconds = parts[0] * 60 + parts[1];
        } else {
            totalSeconds = parts[0] * 60;
        }
    }
    return Number.isSafeInteger(totalSeconds) ? formatDuration(totalSeconds) : null;
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

export function formatSleepTime(val: unknown): string {
    if (typeof val !== 'string') return '';
    const match = /^(\d{1,2}):(\d{1,2})$/.exec(val.trim());
    if (!match) return '';
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return '';
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function parseSleepInput(val: unknown): string | null {
    const formatted = formatSleepTime(val);
    return formatted || null;
}

export function isSleepTimeValid(val: string | undefined | null): boolean {
    if (!val || typeof val !== 'string' || !val.trim()) return false;
    return parseSleepInput(val) !== null;
}