import Fuse from 'fuse.js';
import { MUSCLES } from '../constants/muscles';
import { normalizeStem } from './searchNormalization';

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
