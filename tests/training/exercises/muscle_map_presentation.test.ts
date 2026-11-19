import { describe, expect, it } from 'vitest';
import {
    expandMusclePaths,
    getMuscleForPath,
    getMusclePathStyle,
    getPainMuscleColors,
} from '../../../src/lib/calc/muscleMapPresentation';

describe('muscle model presentation projection', () => {
    it('resolves SVG paths to the most specific interactive muscle without changing group priority', () => {
        expect(getMuscleForPath('chest-lower-left')).toBe('chest_lower_left');
        expect(getMuscleForPath('chest-upper-right')).toBe('chest_upper_right');
        expect(getMuscleForPath('not-a-muscle-path')).toBeUndefined();
    });

    it('expands known groups once, retains unknown IDs and ignores malformed selections', () => {
        const expanded = expandMusclePaths(['chest_upper', 'chest_upper_left', 'unknown-muscle', '', null as unknown as string]);
        expect([...expanded]).toEqual(['chest-upper-left', 'chest-upper-right', 'unknown-muscle']);
    });

    it('preserves direct path override before inverse-name and group fallback colors', () => {
        const primary = expandMusclePaths(['chest']);
        const secondary = expandMusclePaths(['chest_upper']);
        expect(getMusclePathStyle('chest-upper-left', primary, secondary, undefined, false)).toMatchObject({
            fill: 'var(--primary-color)',
            cursor: 'default',
        });
        expect(getMusclePathStyle('chest-upper-left', new Set(), secondary, undefined, true)).toMatchObject({
            fill: 'var(--accent-color)',
            cursor: 'pointer',
        });
        const aliases = { chest: '#112233', chest_upper_left: '#445566', 'chest-upper-left': '#778899' };
        expect(getMusclePathStyle('chest-upper-left', primary, secondary, aliases, true)).toMatchObject({
            fill: '#778899',
            stroke: 'var(--bg-card)',
        });
        expect(getMusclePathStyle('chest-upper-left', primary, secondary, { chest: '#112233' }, true).fill)
            .toBe('#112233');
        expect(getMusclePathStyle('chest-upper-left', primary, secondary, { chest_upper_left: '#445566' }, true).fill)
            .toBe('#445566');
    });

    it('uses the same color projection for active and post-session pains, including atomic SVG paths', () => {
        const colors = getPainMuscleColors(['chest_upper', 'unknown', '', null as unknown as string]);
        expect(colors.chest_upper).toBe('var(--muscle-pain)');
        expect(colors['chest-upper-left']).toBe('var(--muscle-pain)');
        expect(colors['chest-upper-right']).toBe('var(--muscle-pain)');
        expect(colors.unknown).toBe('var(--muscle-pain)');
        expect(colors['']).toBeUndefined();
    });
});
