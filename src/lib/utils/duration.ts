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
