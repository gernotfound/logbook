import Fuse from 'fuse.js';
import { MUSCLES } from '../constants/muscles';
import { getDetailedMuscleCategory } from './planning';

export const normalizeStem = (str: string): string => {
    if (!str || typeof str !== 'string') return '';
    return str
        .toLowerCase()
        .replace(/\bdeltoidi\b/g, 'deltoid')
        .replace(/\bdeltoide\b/g, 'deltoid')
        .replace(/\bfrontali\b/g, 'anterior')
        .replace(/\bfrontale\b/g, 'anterior')
        .replace(/\banteriori\b/g, 'anterior')
        .replace(/\banteriore\b/g, 'anterior')
        .replace(/\blaterali\b/g, 'lateral')
        .replace(/\blaterale\b/g, 'lateral')
        .replace(/\bposteriori\b/g, 'posterior')
        .replace(/\bposteriore\b/g, 'posterior')
        .replace(/\btrapezi\b/g, 'trapez')
        .replace(/\btrapezio\b/g, 'trapez')
        .replace(/\bpettorali\b/g, 'petto')
        .replace(/\bpettorale\b/g, 'petto')
        .replace(/\bbicipiti\b/g, 'bicipit')
        .replace(/\bbicipite\b/g, 'bicipit')
        .replace(/\btricipiti\b/g, 'tricipit')
        .replace(/\btricipite\b/g, 'tricipit')
        .replace(/\bquadricipiti\b/g, 'quadricipit')
        .replace(/\bquadricipite\b/g, 'quadricipit')
        .replace(/\bfemorali\b/g, 'femoral')
        .replace(/\bfemorale\b/g, 'femoral')
        .replace(/\bpolpacci\b/g, 'polpacc')
        .replace(/\bpolpaccio\b/g, 'polpacc')
        .replace(/\baddominali\b/g, 'addom')
        .replace(/\baddominale\b/g, 'addom');
};

export function searchExerciseLibrary(library: any[], query: string): any[] {
    if (!Array.isArray(library)) return [];
    if (!query || typeof query !== 'string' || !query.trim()) {
        return [...library].sort((a, b) => (a?.name || '').localeCompare(b?.name || '', 'it'));
    }

    const q = query.trim().toLowerCase();
    const stemmedQ = normalizeStem(q);
    const tokens = q.split(/\s+/).filter(t => t.length >= 1);
    const stemmedTokens = stemmedQ.split(/\s+/).filter(t => t.length >= 1);

    const muscleMap = new Map();
    if (Array.isArray(MUSCLES)) {
        MUSCLES.forEach(m => {
            if (m && m.id) muscleMap.set(m.id, (m.name || '').toLowerCase());
        });
    }

    const enriched = library.map(ex => {
        if (!ex) return { ...ex, _searchName: '', _stemmedName: '', _searchMuscles: '', _searchSecMuscles: '', _searchNotes: '', _searchType: '' };

        const pMuscleNames = (ex.muscles || []).map((mId: string) => {
            const mName = muscleMap.get(mId) || mId;
            const { label } = getDetailedMuscleCategory(mId);
            return `${mName} ${label.toLowerCase()} ${mId}`;
        }).join(' ');

        const sMuscleNames = (ex.secondaryMuscles || []).map((mId: string) => {
            const mName = muscleMap.get(mId) || mId;
            const { label } = getDetailedMuscleCategory(mId);
            return `${mName} ${label.toLowerCase()} ${mId}`;
        }).join(' ');

        const trackingTypeStr = ex.trackingType === 'cardio' ? 'cardio corsa cyclette' : ex.trackingType === 'time' ? 'tempo isometrico isometria plank' : 'peso ripetizioni';

        return {
            ...ex,
            _searchName: (ex.name || '').toLowerCase(),
            _stemmedName: normalizeStem((ex.name || '').toLowerCase()),
            _searchMuscles: normalizeStem(pMuscleNames.toLowerCase()),
            _searchSecMuscles: normalizeStem(sMuscleNames.toLowerCase()),
            _searchNotes: (ex.notes || '').toLowerCase(),
            _searchType: trackingTypeStr
        };
    });

    // 1. Direct and multi-token substring matches
    const directMatches = enriched.filter(item => {
        if (!item._searchName) return false;
        // Direct match in name or stemmed name
        if (item._searchName.includes(q) || item._stemmedName.includes(stemmedQ)) return true;
        // Direct match in muscles
        if (item._searchMuscles.includes(q) || item._searchMuscles.includes(stemmedQ)) return true;
        if (item._searchSecMuscles.includes(q) || item._searchSecMuscles.includes(stemmedQ)) return true;
        // Direct match in notes
        if (item._searchNotes.includes(q)) return true;
        // Multi-token: each token matches either name, muscles, notes, or type
        if (tokens.length > 1 && tokens.every((tok, idx) => {
            const sTok = stemmedTokens[idx] || tok;
            return (
                item._searchName.includes(tok) ||
                item._stemmedName.includes(sTok) ||
                item._searchMuscles.includes(tok) ||
                item._searchMuscles.includes(sTok) ||
                item._searchSecMuscles.includes(tok) ||
                item._searchSecMuscles.includes(sTok) ||
                item._searchNotes.includes(tok) ||
                item._searchType.includes(tok)
            );
        })) {
            return true;
        }
        return false;
    });

    // 2. Fuzzy matches with Fuse.js
    const fuse = new Fuse(enriched, {
        keys: [
            { name: '_searchName', weight: 0.55 },
            { name: '_stemmedName', weight: 0.15 },
            { name: '_searchMuscles', weight: 0.20 },
            { name: '_searchSecMuscles', weight: 0.05 },
            { name: '_searchNotes', weight: 0.05 }
        ],
        threshold: 0.38,
        ignoreLocation: true,
        minMatchCharLength: 2
    });

    let fuzzyMatches: any[] = [];
    if (tokens.length > 1) {
        const tokenMatches = tokens.map(tok => new Set(fuse.search(tok).map(r => r.item)));
        const allMatch = enriched.filter(item => tokenMatches.every(set => set.has(item)));
        const singleMatches = fuse.search(query.trim()).map(res => res.item);
        fuzzyMatches = [...allMatch, ...singleMatches];
    } else {
        fuzzyMatches = fuse.search(query.trim()).map(res => res.item);
    }

    const seen = new Set<string>();
    const results: any[] = [];
    for (const item of [...directMatches, ...fuzzyMatches]) {
        const key = item.id;
        if (key && !seen.has(key)) {
            seen.add(key);
            const { _searchName, _stemmedName, _searchMuscles, _searchSecMuscles, _searchNotes, _searchType, ...original } = item;
            results.push(original);
        }
    }

    return results;
}

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
    // Fuse.js fuzzy search with multi-token support
    const fuse = new Fuse(items, {
        keys: fields,
        threshold: 0.38,
        ignoreLocation: true,
        minMatchCharLength: 2,
    });
    const tokens = query.trim().split(/\s+/).filter(t => t.length >= 2);
    let fuzzy: any[] = [];
    if (tokens.length > 1) {
        const tokenMatches = tokens.map(tok => new Set(fuse.search(tok).map(r => r.item)));
        const allMatch = items.filter(item => tokenMatches.every(set => set.has(item)));
        const singleMatches = fuse.search(query.trim()).map(res => res.item);
        fuzzy = [...allMatch, ...singleMatches];
    } else {
        fuzzy = fuse.search(query.trim()).map(res => res.item);
    }

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

export interface VolumeExerciseRef {
    isBodyweight?: boolean;
    equipmentWeight?: number;
}

export function getLatestUserWeight(
    nutrition?: Record<string, any> | null,
    nutritionPlanning?: { weight?: number | string } | null
): number {
    let latestWeight: number | null = null;
    if (nutrition && typeof nutrition === 'object') {
        const dates = Object.keys(nutrition).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
        for (const d of dates) {
            const day = nutrition[d];
            if (day && day.weight !== undefined && day.weight !== null && day.weight !== '') {
                const raw = typeof day.weight === 'string' ? day.weight.trim().replace(',', '.') : day.weight;
                const num = parseFloat(String(raw));
                if (!isNaN(num) && num > 0) {
                    latestWeight = num;
                }
            }
        }
    }
    if (latestWeight !== null) return latestWeight;
    if (nutritionPlanning?.weight) {
        const raw = typeof nutritionPlanning.weight === 'string' ? nutritionPlanning.weight.trim().replace(',', '.') : nutritionPlanning.weight;
        const planWeight = parseFloat(String(raw));
        if (!isNaN(planWeight) && planWeight > 0) return planWeight;
    }
    return 80;
}

export function calculateEffectiveSetWeight(
    setKg: string | number | undefined | null,
    exercise?: VolumeExerciseRef | null,
    userWeight: number = 80
): number {
    const raw = typeof setKg === 'string' ? setKg.trim().replace(',', '.') : setKg;
    const baseKg = parseFloat(String(raw ?? '')) || 0;
    const bw = (exercise?.isBodyweight && userWeight > 0) ? userWeight : 0;
    const eq = (exercise?.equipmentWeight && Number(exercise.equipmentWeight) > 0)
        ? (typeof exercise.equipmentWeight === 'string' ? parseFloat(String(exercise.equipmentWeight).replace(',', '.')) || 0 : exercise.equipmentWeight)
        : 0;
    return baseKg + bw + eq;
}

export function calculateSetVolume(
    set: {
        kg?: string | number;
        reps?: string | number;
        dropsets?: Array<{ kg?: string | number; reps?: string | number }>;
    },
    exercise?: VolumeExerciseRef | null,
    userWeight: number = 80
): number {
    if (!set) return 0;
    const reps = parseInt(String(set.reps ?? ''), 10) || 0;
    const effectiveWeight = calculateEffectiveSetWeight(set.kg, exercise, userWeight);
    let volume = effectiveWeight * reps;

    if (Array.isArray(set.dropsets)) {
        for (const ds of set.dropsets) {
            const dsReps = parseInt(String(ds.reps ?? ''), 10) || 0;
            const dsEffectiveWeight = calculateEffectiveSetWeight(ds.kg, exercise, userWeight);
            volume += dsEffectiveWeight * dsReps;
        }
    }
    return volume;
}

export function calculateWorkoutVolume(
    session: { exercises?: Array<{ exId?: string; sets?: any[] }> },
    library: Array<{ id: string; isBodyweight?: boolean; equipmentWeight?: number }> = [],
    userWeight: number = 80
): number {
    if (!session || !Array.isArray(session.exercises)) return 0;
    const libMap = new Map<string, VolumeExerciseRef>();
    library.forEach(ex => {
        if (ex?.id) libMap.set(ex.id, ex);
    });

    let totalVolume = 0;
    for (const ex of session.exercises) {
        if (!ex) continue;
        const libEx = ex.exId ? libMap.get(ex.exId) : null;
        for (const s of (ex.sets || [])) {
            totalVolume += calculateSetVolume(s, libEx, userWeight);
        }
    }
    return totalVolume;
}

const PREPARED_MUSCLES = (Array.isArray(MUSCLES) ? MUSCLES : []).map(m => ({
    ...m,
    _stemmedName: normalizeStem(m.name.toLowerCase())
}));

const STATIC_MUSCLE_FUSE = new Fuse(PREPARED_MUSCLES, {
    keys: [
        { name: 'name', weight: 0.6 },
        { name: '_stemmedName', weight: 0.4 },
        { name: 'id', weight: 0.3 }
    ],
    threshold: 0.38,
    ignoreLocation: true,
    minMatchCharLength: 2
});

export function getMuscleName(id: string): string {
    if (!id || typeof id !== 'string') return '';
    const found = MUSCLES.find(m => m.id === id);
    return found ? found.name : id;
}

export function searchMuscles(query: string, limit: number = 10): Array<{ id: string; name: string }> {
    if (!query || typeof query !== 'string' || !query.trim()) return [];
    const rawQuery = query.trim().toLowerCase();
    const stemmedQuery = normalizeStem(rawQuery);
    const queryTokens = stemmedQuery.split(/\s+/).filter(Boolean);

    // 1. Direct matches
    const directMatches = MUSCLES.filter(m => {
        const mNameLower = m.name.toLowerCase();
        if (mNameLower.includes(rawQuery)) return true;
        if (m.id.toLowerCase().includes(rawQuery)) return true;
        const mNameNorm = normalizeStem(mNameLower);
        return queryTokens.every(tok => mNameNorm.includes(tok));
    });

    // 2. Fuzzy matches with static Fuse
    const fuzzyMatches = STATIC_MUSCLE_FUSE.search(stemmedQuery).map(res => {
        const { _stemmedName, ...original } = res.item;
        return original;
    });

    const seen = new Set<string>();
    const merged: Array<{ id: string; name: string }> = [];
    for (const m of [...directMatches, ...fuzzyMatches]) {
        if (!seen.has(m.id)) {
            seen.add(m.id);
            merged.push(m);
        }
    }

    merged.sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        if (aName === rawQuery) return -1;
        if (bName === rawQuery) return 1;
        const aStarts = aName.startsWith(rawQuery);
        const bStarts = bName.startsWith(rawQuery);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        const aIsBase = !a.id.endsWith('_left') && !a.id.endsWith('_right');
        const bIsBase = !b.id.endsWith('_left') && !b.id.endsWith('_right');
        if (aIsBase && !bIsBase) return -1;
        if (!aIsBase && bIsBase) return 1;
        return a.name.localeCompare(b.name, 'it');
    });

    return merged.slice(0, limit);
}

export function autoHealPains(
    activePains: string[] = [],
    sessionExercises: Array<{ exId?: string }> = [],
    library: Array<{ id: string; muscles?: string[] }> = [],
    sessionPains: string[] = []
): string[] {
    const safeActivePains = Array.isArray(activePains) ? activePains.filter((p): p is string => typeof p === 'string' && Boolean(p.trim())) : [];
    const safeSessionExercises = Array.isArray(sessionExercises) ? sessionExercises.filter(Boolean) : [];
    const safeLibrary = Array.isArray(library) ? library.filter(Boolean) : [];
    const safeSessionPains = Array.isArray(sessionPains) ? sessionPains.filter((p): p is string => typeof p === 'string' && Boolean(p.trim())) : [];

    const libMap = new Map<string, { id: string; muscles?: string[] }>();
    safeLibrary.forEach(ex => {
        if (ex && ex.id) libMap.set(ex.id, ex);
    });

    const trainedPrimaryMuscles = new Set<string>();
    for (const se of safeSessionExercises) {
        if (!se || !se.exId) continue;
        const ex = libMap.get(se.exId);
        if (Array.isArray(ex?.muscles)) {
            ex.muscles.forEach(m => {
                if (m && typeof m === 'string') {
                    trainedPrimaryMuscles.add(m);
                    // Add lateral and base variants
                    if (!m.endsWith('_left') && !m.endsWith('_right')) {
                        trainedPrimaryMuscles.add(`${m}_left`);
                        trainedPrimaryMuscles.add(`${m}_right`);
                    } else {
                        const base = m.replace(/_(left|right)$/, '');
                        trainedPrimaryMuscles.add(base);
                    }
                }
            });
        }
    }

    const sessionPainsSet = new Set<string>();
    safeSessionPains.forEach(p => {
        if (p && typeof p === 'string') {
            sessionPainsSet.add(p);
            if (!p.endsWith('_left') && !p.endsWith('_right')) {
                sessionPainsSet.add(`${p}_left`);
                sessionPainsSet.add(`${p}_right`);
            } else {
                const base = p.replace(/_(left|right)$/, '');
                sessionPainsSet.add(base);
            }
        }
    });

    const resultPains: string[] = [];
    const seen = new Set<string>();

    // Evaluate active pains
    for (const pain of safeActivePains) {
        if (trainedPrimaryMuscles.has(pain)) {
            // Trained as primary: keep only if explicitly selected in session pains
            if (sessionPainsSet.has(pain)) {
                if (!seen.has(pain)) {
                    seen.add(pain);
                    resultPains.push(pain);
                }
            }
        } else {
            // Untrained: preserve
            if (!seen.has(pain)) {
                seen.add(pain);
                resultPains.push(pain);
            }
        }
    }

    // Add new session pains
    for (const pain of safeSessionPains) {
        if (!seen.has(pain)) {
            seen.add(pain);
            resultPains.push(pain);
        }
    }

    return resultPains;
}




