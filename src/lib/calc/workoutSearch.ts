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

/** Searchable exercise shape; preserve specialized exercise metadata on return. */
interface SearchableExercise {
    id?: string;
    name?: string;
    muscles?: string[];
    secondaryMuscles?: string[];
    notes?: string;
    trackingType?: string;
}

function buildExerciseLibrarySearcher<T extends SearchableExercise>(library: T[]): (query: string) => T[] {
    if (!Array.isArray(library)) return () => [];

    const muscleMap = new Map<string, string>();
    if (Array.isArray(MUSCLES)) {
        MUSCLES.forEach(m => {
            if (m && m.id) muscleMap.set(m.id, (m.name || '').toLowerCase());
        });
    }

    const enriched = library.map(ex => {
        if (!ex) return { ...((ex || {}) as T), _searchName: '', _stemmedName: '', _searchMuscles: '', _searchSecMuscles: '', _searchNotes: '', _searchType: '' };

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


    return (query: string): T[] => {
        // Public search entry points handle empty queries before building the index.
        const q = query.trim().toLowerCase();
        const stemmedQ = normalizeStem(q);
        const tokens = q.split(/\s+/).filter(t => t.length >= 1);
        const stemmedTokens = stemmedQ.split(/\s+/).filter(t => t.length >= 1);

        // 1. Direct and multi-token substring matches
        const directMatches = enriched.filter(item => {
            if (!item._searchName) return false;
            // Direct match in name or stemmed name
            if (item._searchName.includes(q) || item._stemmedName.includes(stemmedQ)) return true;
            // Direct match in muscles
            if (item._searchMuscles.includes(q) || item._searchMuscles.includes(stemmedQ)) return true;
            if (item._searchSecMuscles.includes(q) || item._searchSecMuscles.includes(stemmedQ)) return true;
            if (item._searchType.includes(q)) return true;
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

        let fuzzyMatches: typeof enriched = [];
        if (tokens.length > 1) {
            const tokenMatches = tokens.map(tok => new Set(fuse.search(tok).map(r => r.item)));
            const allMatch = enriched.filter(item => tokenMatches.every(set => set.has(item)));
            const singleMatches = fuse.search(query.trim()).map(res => res.item);
            fuzzyMatches = [...allMatch, ...singleMatches];
        } else {
            fuzzyMatches = fuse.search(query.trim()).map(res => res.item);
        }

        const seen = new Set<string>();
        const results: T[] = [];
        for (const item of [...directMatches, ...fuzzyMatches]) {
            const key = item.id;
            if (key && !seen.has(key)) {
                seen.add(key);
                const { _searchName, _stemmedName, _searchMuscles, _searchSecMuscles, _searchNotes, _searchType, ...original } = item;
                // Only temporary index fields are removed; the original T fields remain.
                results.push(original as unknown as T);
            }
        }

        return results;
    };
}

export function createExerciseLibrarySearcher<T extends SearchableExercise>(library: T[]): (query: string) => T[] {
    if (!Array.isArray(library)) return () => [];
    let prepared: ((query: string) => T[]) | null = null;
    let sortedLibrary: T[] | null = null;
    return (query: string): T[] => {
        if (!query || typeof query !== 'string' || !query.trim()) {
            sortedLibrary ??= [...library].sort((a, b) => (a?.name || '').localeCompare(b?.name || '', 'it'));
            return [...sortedLibrary];
        }
        if (!prepared) prepared = buildExerciseLibrarySearcher(library);
        return prepared(query);
    };
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
