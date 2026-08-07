import Fuse from 'fuse.js';
import { MUSCLES } from '../constants/muscles';

export function filterItems(items: any[], query: string, searchFields: string | string[] = ['name']) {
    if (!Array.isArray(items)) return [];
    if (!query || typeof query !== 'string' || !query.trim()) return items;
    const q = query.trim().toLowerCase();
    const fields = Array.isArray(searchFields) ? searchFields : [searchFields];

    // Direct matches
    const direct = items.filter(item => {
        if (!item) return false;
        return fields.some(field => {
            const val = item[field];
            return val && val.toString().toLowerCase().includes(q);
        });
    });

    // Fuzzy matches with Fuse.js
    const fuse = new Fuse(items, {
        keys: fields,
        threshold: 0.38,
        ignoreLocation: true,
        minMatchCharLength: 2,
    });
    const fuzzy = fuse.search(query.trim()).map(res => res.item);

    // Merge direct + fuzzy without duplicates, keeping direct first
    const seen = new Set<any>();
    const result: any[] = [];
    for (const it of [...direct, ...fuzzy]) {
        const key = it.id ?? it;
        if (!seen.has(key)) {
            seen.add(key);
            result.push(it);
        }
    }
    return result;
}

export function searchRoutines(routines: any[], libraryOrQuery: any, queryMaybe?: string) {
    let library: any[] = [];
    let query: string = '';
    if (queryMaybe !== undefined) {
        library = Array.isArray(libraryOrQuery) ? libraryOrQuery : [];
        query = queryMaybe || '';
    } else if (typeof libraryOrQuery === 'string') {
        query = libraryOrQuery;
    }

    if (!query || typeof query !== 'string' || !query.trim()) return routines || [];
    const q = query.trim().toLowerCase();
    const libMap = new Map();
    if (Array.isArray(library)) {
        library.forEach(ex => {
            if (ex && ex.id) libMap.set(ex.id, ex);
        });
    }
    const muscleNameMap = new Map();
    if (Array.isArray(MUSCLES)) {
        MUSCLES.forEach(m => {
            if (m && m.id) muscleNameMap.set(m.id, (m.name || '').toLowerCase());
        });
    }

    const directMatches = (routines || []).filter(routine => {
        if (!routine) return false;
        if (routine.name && routine.name.toLowerCase().includes(q)) return true;
        if (routine.description && routine.description.toLowerCase().includes(q)) return true;
        if (Array.isArray(routine.targetMuscles)) {
            const matchTarget = routine.targetMuscles.some((mId: string) => {
                const mName = muscleNameMap.get(mId) || '';
                return mId.toLowerCase().includes(q) || mName.includes(q);
            });
            if (matchTarget) return true;
        }
        if (Array.isArray(routine.exercises)) {
            for (const re of routine.exercises) {
                if (!re) continue;
                let ex = null;
                if (typeof re === 'string') {
                    ex = libMap.get(re);
                } else if (typeof re === 'object') {
                    ex = libMap.get(re.id) || libMap.get(re.exerciseId) || re;
                }
                if (ex) {
                    if (ex.name && ex.name.toLowerCase().includes(q)) return true;
                    if (Array.isArray(ex.muscles)) {
                        const matchExMuscle = ex.muscles.some((mId: string) => {
                            const mName = muscleNameMap.get(mId) || '';
                            return mId.toLowerCase().includes(q) || mName.includes(q);
                        });
                        if (matchExMuscle) return true;
                    }
                }
            }
        }
        return false;
    });

    const preparedRoutines = (routines || []).map(r => {
        let exNames = '';
        if (Array.isArray(r.exercises)) {
            exNames = r.exercises.map((re: any) => {
                const ex = typeof re === 'string' ? libMap.get(re) : (libMap.get(re.id) || libMap.get(re.exerciseId) || re);
                return ex ? (ex.name || '') : '';
            }).join(' ');
        }
        let targetMuscleNames = '';
        if (Array.isArray(r.targetMuscles)) {
            targetMuscleNames = r.targetMuscles.map((mId: string) => muscleNameMap.get(mId) || mId).join(' ');
        }
        return {
            ...r,
            _searchEx: exNames,
            _searchMuscles: targetMuscleNames
        };
    });

    const fuse = new Fuse(preparedRoutines, {
        keys: [
            { name: 'name', weight: 0.5 },
            { name: 'description', weight: 0.2 },
            { name: '_searchMuscles', weight: 0.2 },
            { name: '_searchEx', weight: 0.3 }
        ],
        threshold: 0.38,
        ignoreLocation: true,
        minMatchCharLength: 2
    });

    const fuzzyMatches = fuse.search(query.trim()).map(res => {
        const { _searchEx, _searchMuscles, ...original } = res.item;
        return original;
    });

    const seen = new Set<any>();
    const result: any[] = [];
    for (const r of [...directMatches, ...fuzzyMatches]) {
        const key = r.id ?? r;
        if (!seen.has(key)) {
            seen.add(key);
            result.push(r);
        }
    }
    return result;
}

export function validateWorkoutRatings(mood: any, pump?: any, fatigue?: any) {
    // Also support object param if passed as single object
    if (typeof mood === 'object' && mood !== null && !Array.isArray(mood) && pump === undefined) {
        fatigue = mood.fatigue || mood.fatigueRating;
        pump = mood.pump || mood.pumpRating;
        mood = mood.mood || mood.moodRating;
    }
    const checkRating = (val: any) => {
        if (val === null || val === undefined || val === '') return { val: null, invalid: false };
        if (typeof val === 'number') {
            const ok = Number.isInteger(val) && val >= 1 && val <= 10;
            return { val: ok ? val : null, invalid: !ok };
        }
        if (typeof val === 'string') {
            const trimmed = val.trim();
            if (trimmed === '') return { val: null, invalid: false };
            if (/^\d+$/.test(trimmed)) {
                const num = parseInt(trimmed, 10);
                const ok = num >= 1 && num <= 10;
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
            mood: m.invalid ? "Voto umore deve essere un intero da 1 a 10" : null,
            pump: p.invalid ? "Voto pump deve essere un intero da 1 a 10" : null,
            fatigue: f.invalid ? "Voto stanchezza deve essere un intero da 1 a 10" : null
        }
    };
}

export function validateHistory(history: any[]) {
    if (!Array.isArray(history)) return [];
    return history;
}

export function getWorkoutDatesSet(history: any[]): Set<string> {
    const datesSet = new Set<string>();
    if (!Array.isArray(history)) return datesSet;
    history.forEach(item => {
        if (!item) return;
        let dStr = item.date || item.dateStr;
        if (dStr) {
            if (typeof dStr === 'string') {
                dStr = dStr.split('T')[0].trim();
            } else if (dStr instanceof Date) {
                const pad = (n: number) => String(n).padStart(2, '0');
                dStr = `${dStr.getFullYear()}-${pad(dStr.getMonth() + 1)}-${pad(dStr.getDate())}`;
            }
            if (/^\d{4}-\d{2}-\d{2}$/.test(dStr)) {
                datesSet.add(dStr);
            }
        }
    });
    return datesSet;
}


