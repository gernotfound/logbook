import Fuse from 'fuse.js';

const normalizeFoodStr = (str: unknown): string => String(str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

const FUSE_FOOD_OPTIONS = {
    keys: [
        { name: 'name', weight: 0.6 },
        { name: 'brand', weight: 0.25 },
        { name: 'category', weight: 0.15 }
    ],
    threshold: 0.38,
    ignoreLocation: true,
    minMatchCharLength: 2
};

/** Keep all food metadata and caller-specific fields intact through filtering. */
interface SearchableFood {
    id?: string | number;
    name: string;
    brand?: string;
    category?: string;
    servingUnit?: string;
    unit?: string;
}

export function createFoodSearcher<T extends SearchableFood>(foodsList: T[], categoryFilter?: string): (query: string, maxResults?: number) => T[] {
    if (!Array.isArray(foodsList) || foodsList.length === 0) return () => [];
    let results = foodsList;
    if (categoryFilter && categoryFilter !== 'all') {
        results = results.filter(item => item && item.category === categoryFilter);
    }
    type PreparedFood = { item: T; name: string; category: string; servingUnit: string; brand: string } | null;
    let prepared: PreparedFood[] | undefined;
    const normalizedNames = new Map<T, string>();
    let fuse: Fuse<T> | undefined;
    const nameOf = (item: T) => normalizedNames.get(item) ?? normalizeFoodStr(item.name);
    const sortMatches = (items: T[], q: string, limit?: number): T[] => {
        const compare = (a: T, b: T): number => {
            const aName = nameOf(a);
            const bName = nameOf(b);
            const aStarts = aName.startsWith(q);
            const bStarts = bName.startsWith(q);
            if (aStarts && !bStarts) return -1;
            if (!aStarts && bStarts) return 1;
            return aName.localeCompare(bName, 'it');
        };
        if (limit === undefined || items.length <= limit) {
            return items.sort(compare);
        }
        // Insertion after equal-ranked entries retains the same stable order as a full sort.
        const top: T[] = [];
        for (const item of items) {
            let low = 0;
            let high = top.length;
            while (low < high) {
                const mid = Math.floor((low + high) / 2);
                if (compare(item, top[mid]) < 0) high = mid;
                else low = mid + 1;
            }
            if (low >= limit) continue;
            top.splice(low, 0, item);
            if (top.length > limit) top.pop();
        }
        return top;
    };
    return (query: string, maxResults?: number): T[] => {
        // Invalid limits are unbounded, regardless of whether a query is empty.
        const limit = typeof maxResults === 'number' && Number.isSafeInteger(maxResults) && maxResults > 0
            ? maxResults : undefined;
        if (typeof query !== 'string' || !query.trim()) {
            return limit === undefined ? results : results.slice(0, limit);
        }
        const q = normalizeFoodStr(query);
        if (!q) return limit === undefined ? results : results.slice(0, limit);

        if (!prepared) {
            prepared = results.map(item => item ? {
                item,
                name: normalizeFoodStr(item.name),
                category: normalizeFoodStr(item.category),
                servingUnit: normalizeFoodStr(item.servingUnit || item.unit),
                brand: normalizeFoodStr(item.brand)
            } : null);
            for (const entry of prepared) {
                if (entry) normalizedNames.set(entry.item, entry.name);
            }
        }

        // Direct substring matches
        const directMatched: T[] = [];
        for (const entry of prepared) {
            if (entry && (entry.name.includes(q) || entry.category.includes(q)
                || entry.servingUnit.includes(q) || entry.brand.includes(q))) {
                directMatched.push(entry.item);
            }
        }

        if (q.length < 2) {
            return sortMatches(directMatched, q, limit);
        }

        // Build Fuse only if the query actually needs fuzzy matching.
        const currentFuse = fuse ?? (fuse = new Fuse(results, FUSE_FOOD_OPTIONS));

        const tokens = query.trim().split(/\s+/).filter(t => t.length >= 2);
        let fuzzyMatched: T[] = [];
        if (tokens.length > 1) {
            // Find items that match all tokens
            const tokenMatches = tokens.map(tok => new Set(currentFuse.search(tok).map(r => r.item)));
            const allMatch = results.filter(item => tokenMatches.every(set => set.has(item)));
            const singleMatches = currentFuse.search(query.trim()).map(res => res.item);
            fuzzyMatched = [...allMatch, ...singleMatches];
        } else {
            fuzzyMatched = currentFuse.search(query.trim()).map(res => res.item);
        }

        const seen = new Set<string | number>();
        const merged: T[] = [];
        for (const f of [...directMatched, ...fuzzyMatched]) {
            const key = f.id ?? f.name;
            if (!seen.has(key)) {
                seen.add(key);
                merged.push(f);
            }
        }

        return sortMatches(merged, q, limit);
    };
}

