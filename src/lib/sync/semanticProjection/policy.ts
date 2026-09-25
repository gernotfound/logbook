import type { MergePolicy } from './contracts';

export function getMergePolicy(docPath: string, path: string[]): MergePolicy {
    if (docPath === '') {
        const root = path[0];
        if (['profile', 'nutritionPlanning', 'catalogOverrides'].includes(root)) return 'property';
        if (['library', 'customFoods'].includes(root)) {
            if (path.length === 1) return 'keyed';
            return 'property';
        }
        if (['routines', 'trainingCycles', 'supplements'].includes(root)) {
            if (path.length === 1) return 'ordered-keyed';
            if (root === 'routines' && path.length === 3 && path[2] === 'exercises') return 'ordered-keyed';
            if (root === 'trainingCycles' && path.length === 3 && path[2] === 'routines') return 'ordered-keyed';
            return 'property';
        }
        if (['history'].includes(root)) {
            if (path.length === 1) return 'keyed';
            return 'property';
        }
        if (root === 'activeWorkout') {
            if (path.length === 1) return 'property';
            if (path[1] === 'exercises') {
                if (path.length === 2) return 'ordered-keyed';
                if (path.length === 3) return 'property';
                if (path[3] === 'sets') {
                    if (path.length === 4) return 'keyed';
                    if (path.length === 6 && path[5] === 'segments') return 'ordered-keyed';
                    return 'property';
                }
                return 'property';
            }
            return 'property';
        }
        return 'atomic';
    }

    if (docPath.startsWith('nutrition_months/')) {
        if (path.length === 1) return 'property';
        const prop = path[1];
        if (path.length === 2 && ['kcal', 'carbs', 'pro', 'fat'].includes(String(prop))) return 'ignore';
        if (prop === 'meals' || prop === 'supplementsIntake' || prop === 'cardioSessions' || prop === 'contextEvents') {
            if (path.length === 2) return 'keyed';
            return 'property';
        }
        return 'property';
    }

    if (docPath.startsWith('history_months/')) {
        if (path.length === 1) return 'property';
        if (path[1] === 'exercises') {
            if (path.length === 2) return 'ordered-keyed';
            if (path.length === 3) return 'property';
            if (path[3] === 'sets') {
                if (path.length === 4) return 'keyed';
                if (path.length === 6 && path[5] === 'segments') return 'ordered-keyed';
                return 'property';
            }
            return 'property';
        }
        return 'property';
    }

    return 'atomic';
}

export function resolveIdentity(path: string[], item: any): string {
    const collection = path[path.length - 1];
    let id: any;
    if (collection === 'exercises') id = item.exId ?? item.id;
    else if (path[0] === 'trainingCycles' && collection === 'routines') id = item.routineId;
    else id = item.id ?? item.exId ?? item.routineId;

    const strId = String(id);
    if (id === undefined || id === null || strId === '' || strId === 'undefined' || strId === 'null') {
        throw new Error(`Invalid identity in ${collection}`);
    }
    return strId;
}

export function identitySeed(path: string[], itemId: string): Record<string, string> {
    const collection = path[path.length - 1];
    if (collection === 'exercises') return { exId: itemId };
    if (path[0] === 'trainingCycles' && collection === 'routines') return { routineId: itemId };
    return { id: itemId };
}
