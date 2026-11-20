export function validateWorkoutRatings(mood: unknown, pump?: unknown, fatigue?: unknown) {
    const checkRating = (val: unknown) => {
        if (val === null || val === undefined || val === '') return { val: null, invalid: false };
        if (typeof val === 'number') {
            const ok = Number.isInteger(val) && val >= 1 && val <= 5;
            return { val: ok ? val : null, invalid: !ok };
        }
        if (typeof val === 'string') {
            const trimmed = val.replace(',', '.').trim();
            if (trimmed === '') return { val: null, invalid: false };
            if (/^\d+(\.\d+)?$/.test(trimmed)) {
                const num = parseFloat(trimmed);
                const ok = Number.isInteger(num) && num >= 1 && num <= 5;
                return { val: ok ? num : null, invalid: !ok };
            }
            return { val: null, invalid: true };
        }
        return { val: null, invalid: true };
    };
    const m = checkRating(mood);
    const p = checkRating(pump);
    const f = checkRating(fatigue);
    const isValid = !m.invalid && !p.invalid && !f.invalid;
    return {
        isValid,
        mood: m.val,
        pump: p.val,
        fatigue: f.val,
        errors: {
            mood: m.invalid ? `Voto umore deve essere un valore valido da 1 a 5` : null,
            pump: p.invalid ? `Voto pump deve essere un valore valido da 1 a 5` : null,
            fatigue: f.invalid ? `Voto stanchezza deve essere un valore valido da 1 a 5` : null
        }
    };
}

export function mergeActivePains(
    activePains: string[] = [],
    reportedSessionPains: string[] = []
): string[] {
    const active = Array.isArray(activePains) ? activePains : [];
    const sessionPains = Array.isArray(reportedSessionPains) ? reportedSessionPains : [];
    const result: string[] = [];
    const seen = new Set<string>();

    for (const pain of [...active, ...sessionPains]) {
        if (typeof pain !== 'string') continue;
        const normalized = pain.trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        result.push(normalized);
    }

    return result;
}
