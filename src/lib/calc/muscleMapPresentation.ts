import { GROUP_MAP } from '../constants/muscles';

const REVERSE_GROUP_MAP: Record<string, string> = (() => {
    const inverse: Record<string, string> = {};
    const groups = Object.keys(GROUP_MAP).sort(
        (a, b) => GROUP_MAP[a].length - GROUP_MAP[b].length,
    );
    for (const group of groups) {
        for (const path of GROUP_MAP[group]) {
            if (!Object.prototype.hasOwnProperty.call(inverse, path)) {
                inverse[path] = group;
            }
        }
    }
    return inverse;
})();

export function getMuscleForPath(path: string): string | undefined {
    return REVERSE_GROUP_MAP[path];
}

export function expandMusclePaths(muscles: readonly string[]): Set<string> {
    const paths = new Set<string>();
    for (const muscle of muscles) {
        if (typeof muscle !== 'string' || !muscle) continue;
        const mapped = GROUP_MAP[muscle];
        for (const path of Array.isArray(mapped) ? mapped : [muscle]) {
            paths.add(path);
        }
    }
    return paths;
}

export function getPainMuscleColors(pains: readonly string[]): Record<string, string> {
    const colors: Record<string, string> = {};
    const color = 'var(--muscle-pain)';
    for (const muscle of pains) {
        if (typeof muscle !== 'string' || !muscle) continue;
        colors[muscle] = color;
        const mapped = GROUP_MAP[muscle];
        if (Array.isArray(mapped)) {
            for (const path of mapped) colors[path] = color;
        }
    }
    return colors;
}

export function getMusclePathStyle(
    id: string,
    primaryIds: ReadonlySet<string>,
    secondaryIds: ReadonlySet<string>,
    muscleColors: Readonly<Record<string, string>> | undefined,
    interactive: boolean,
) {
    const logicId = getMuscleForPath(id);
    if (muscleColors) {
        let customColor = muscleColors[id] || (logicId ? muscleColors[logicId] : undefined);
        if (!customColor) {
            for (const [groupKey, color] of Object.entries(muscleColors)) {
                const paths = GROUP_MAP[groupKey];
                if (Array.isArray(paths) && paths.includes(id)) {
                    customColor = color;
                    break;
                }
            }
        }
        if (customColor) {
            return {
                fill: customColor,
                transition: 'fill 0.3s ease',
                stroke: 'var(--bg-card)',
                strokeWidth: '0.5',
            };
        }
    }

    const fill = primaryIds.has(id) ? 'var(--primary-color)'
        : secondaryIds.has(id) ? 'var(--accent-color)'
            : 'var(--surface-light)';
    return {
        fill,
        stroke: 'var(--text-muted)',
        strokeWidth: '0.3',
        cursor: interactive ? 'pointer' : 'default',
    };
}
