import Fuse from 'fuse.js';
import { Logic } from '../../lib/logic';
import type { MuscleDef } from '../../lib/constants/muscles';

type MuscleRef = Pick<MuscleDef, 'id'>;

export const normalizeStem = (str: string): string => {
    return str
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

const PREPARED_MUSCLES = Logic.MUSCLES.map((muscle) => ({
    ...muscle,
    _stemmedName: normalizeStem(muscle.name.toLowerCase())
}));

const STATIC_MUSCLE_FUSE = new Fuse(PREPARED_MUSCLES, {
    keys: [
        { name: 'name', weight: 0.6 },
        { name: '_stemmedName', weight: 0.4 }
    ],
    threshold: 0.38,
    ignoreLocation: true,
    minMatchCharLength: 2
});

export function filterMuscles(query: string): MuscleDef[] {
    const rawQuery = query.trim().toLowerCase();
    if (!rawQuery) return [];

    const stemmedQuery = normalizeStem(rawQuery);
    const queryTokens = stemmedQuery.split(/\s+/).filter(Boolean);

    const directMatches = Logic.MUSCLES.filter((muscle) => {
        const nameLower = muscle.name.toLowerCase();
        if (nameLower.includes(rawQuery)) return true;
        const normalizedName = normalizeStem(nameLower);
        return queryTokens.every((token) => normalizedName.includes(token));
    });

    const fuzzyMatches: MuscleDef[] = STATIC_MUSCLE_FUSE.search(stemmedQuery).map((result) => {
        const { _stemmedName, ...original } = result.item;
        void _stemmedName;
        return original;
    });

    const seen = new Set<string>();
    const merged: MuscleDef[] = [];
    for (const muscle of [...directMatches, ...fuzzyMatches]) {
        if (!seen.has(muscle.id)) {
            seen.add(muscle.id);
            merged.push(muscle);
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

    return merged.slice(0, 10);
}

export function getExpandedMuscleIds(musclesList: MuscleRef[]): Set<string> {
    const set = new Set<string>();
    for (const muscle of musclesList || []) {
        if (!muscle || !muscle.id) continue;
        const leftId = `${muscle.id}_left`;
        const rightId = `${muscle.id}_right`;
        if (
            Logic.MUSCLES.find((candidate) => candidate.id === leftId) &&
            Logic.MUSCLES.find((candidate) => candidate.id === rightId)
        ) {
            set.add(leftId);
            set.add(rightId);
        } else {
            set.add(muscle.id);
        }
    }
    return set;
}

export function toggleSmartMuscleSelection(
    currentSelection: MuscleRef[],
    toggledMuscle?: MuscleRef
): MuscleDef[] {
    const expanded = getExpandedMuscleIds(currentSelection || []);

    if (toggledMuscle?.id) {
        const toggledIds: string[] = [];
        const leftId = `${toggledMuscle.id}_left`;
        const rightId = `${toggledMuscle.id}_right`;
        if (
            Logic.MUSCLES.find((candidate) => candidate.id === leftId) &&
            Logic.MUSCLES.find((candidate) => candidate.id === rightId)
        ) {
            toggledIds.push(leftId, rightId);
        } else {
            toggledIds.push(toggledMuscle.id);
        }

        const allSelected = toggledIds.every((id) => expanded.has(id));
        if (allSelected) {
            toggledIds.forEach((id) => expanded.delete(id));
        } else {
            toggledIds.forEach((id) => expanded.add(id));
        }
    }

    const finalIds = Array.from(expanded).filter(
        (id): id is string => typeof id === 'string' && Boolean(id)
    );

    let changed = true;
    let maxIter = 100;
    while (changed && maxIter-- > 0) {
        changed = false;
        for (let i = 0; i < finalIds.length; i++) {
            const id = finalIds[i];
            if (id && (id.endsWith('_left') || id.endsWith('_right'))) {
                const baseId = id.replace(/_(left|right)$/, '');
                const counterpart = id.endsWith('_left')
                    ? `${baseId}_right`
                    : `${baseId}_left`;
                const counterpartIndex = finalIds.indexOf(counterpart);
                if (
                    counterpartIndex !== -1 &&
                    Logic.MUSCLES.find((candidate) => candidate.id === baseId)
                ) {
                    finalIds.splice(Math.max(i, counterpartIndex), 1);
                    finalIds.splice(Math.min(i, counterpartIndex), 1);
                    if (!finalIds.includes(baseId)) {
                        finalIds.push(baseId);
                    }
                    changed = true;
                    break;
                }
            }
        }
    }

    return finalIds
        .map((id) => Logic.MUSCLES.find((muscle) => muscle.id === id))
        .filter((muscle): muscle is MuscleDef => Boolean(muscle));
}
