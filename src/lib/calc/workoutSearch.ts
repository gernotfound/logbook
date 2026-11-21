import Fuse from 'fuse.js';
import { MUSCLES } from '../constants/muscles';
import { normalizeStem } from './searchNormalization';
import { getDetailedMuscleCategory } from './planning';

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
