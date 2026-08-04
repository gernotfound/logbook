export function generateId(prefix: string): string {
    return prefix + '_' + crypto.randomUUID();
}

export function getLocalDateString(d: Date | string | number = new Date()): string {
    const date = new Date(d);
    if (isNaN(date.getTime())) return new Date().toISOString().split('T')[0];
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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
    const firstDay = new Date(y, m, 1);
    const startOffset = (firstDay.getDay() + 6) % 7;
    const pad = (n: number) => String(n).padStart(2, '0');
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const grid: CalendarDayCell[] = [];
    let cellCount = 0;
    const lastDayOfMonth = new Date(y, m + 1, 0);
    while (cellCount < 35 || (cellCount % 7 !== 0) || (new Date(y, m, 1 - startOffset + cellCount - 1) < lastDayOfMonth)) {
        const curDate = new Date(y, m, 1 - startOffset + cellCount);
        const curYear = curDate.getFullYear();
        const curMonth = curDate.getMonth();
        const dateStr = `${curYear}-${pad(curMonth + 1)}-${pad(curDate.getDate())}`;
        grid.push({
            dayNum: curDate.getDate(),
            dateStr,
            isCurrentMonth: curMonth === m && curYear === y,
            isToday: dateStr === todayStr
        });
        cellCount++;
    }
    return grid;
}
