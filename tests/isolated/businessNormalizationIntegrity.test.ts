import { describe, expect, it } from 'vitest';
import { findLossyNormalization } from '../../src/lib/sync/businessNormalizationIntegrity';
import { assertCloudBusinessPreserved, CloudDataIntegrityError } from '../../src/lib/sync/cloudBusinessIntegrity';
import { UserProfileSchema } from '../../src/lib/schemas/schema_profile';

describe('business normalization integrity', () => {
    it.each([
        ['zero', '0', 0],
        ['negative integer', '-12', -12],
        ['decimal', '12.5', 12.5],
        ['trimmed decimal', ' 12.5 ', 12.5],
        ['exponent', '1e3', 1000],
        ['largest safe integer', '9007199254740991', 9007199254740991],
        ['number to string', 170, '170'],
        ['zero to string', 0, '0'],
        ['decimal to string', 12.5, '12.5'],
        ['negative number to string', -12, '-12'],
        ['true string', 'true', true],
        ['one string', '1', true],
        ['false string', 'false', false],
        ['zero string', '0', false],
        ['numeric true', 1, true],
        ['numeric false', 0, false],
    ] as const)('permits a value-preserving scalar conversion: %s', (_, raw, normalized) => {
        expect(findLossyNormalization({ value: raw }, { value: normalized })).toBeNull();
    });

    it.each([
        ['empty string is not zero', '', 0],
        ['whitespace is not zero', '   ', 0],
        ['non-numeric string', '12kg', 12],
        ['changed numeric value', '12.5', 13],
        ['positive unsafe integer', '9007199254740992', 9007199254740992],
        ['rounded integer digits', '9007199254740993', 9007199254740992],
        ['negative unsafe integer', '-9007199254740992', -9007199254740992],
        ['overflowing numeric text', '1e309', Infinity],
        ['infinite numeric text', 'Infinity', Infinity],
        ['NaN text', 'NaN', NaN],
        ['infinite number', Infinity, 'Infinity'],
        ['negative infinite number', -Infinity, '-Infinity'],
        ['NaN number', NaN, 'NaN'],
        ['changed numeric spelling', 12.5, '12.50'],
        ['changed numeric string', 170, '171'],
        ['true to false', 'true', false],
        ['one to false', '1', false],
        ['false to true', 'false', true],
        ['zero to true', '0', true],
        ['unknown truthy word', 'yes', true],
        ['noncanonical boolean case', 'TRUE', true],
        ['boolean text became unrelated text', 'true', 'false'],
        ['boolean text became null', 'false', null],
        ['empty boolean text', '', false],
        ['numeric one to false', 1, false],
        ['numeric zero to true', 0, true],
        ['other nonzero number', 2, true],
        ['other zero-like number', -1, false],
        ['null coercion', null, 0],
        ['boolean stringification', true, 'true'],
    ] as const)('rejects loss or an unsupported scalar conversion: %s', (_, raw, normalized) => {
        expect(findLossyNormalization({ value: raw }, { value: normalized })).toEqual(['value']);
    });

    it.each([
        ['empty records', {}, {}],
        ['empty arrays', [], []],
        ['unchanged null', null, null],
        ['unchanged boolean', false, false],
        ['unchanged text', 'text', 'text'],
        ['unchanged numeric value', 12.5, 12.5],
    ] as const)('accepts unchanged content: %s', (_, raw, normalized) => {
        expect(findLossyNormalization(raw, normalized)).toBeNull();
    });

    it.each([
        ['array shortened', { items: [1, 2] }, { items: [1] }, ['items']],
        ['array extended', { items: [1] }, { items: [1, 2] }, ['items']],
        ['array became record', { items: [] }, { items: {} }, ['items']],
        ['record became array', { items: {} }, { items: [] }, ['items']],
        ['record became null', { item: { height: 170 } }, { item: null }, ['item']],
        ['scalar became empty record', { item: 7 }, { item: {} }, ['item']],
        ['nested field removed', { profile: { height: '170' } }, { profile: {} }, ['profile', 'height']],
        ['nested value changed', { profile: { height: '170' } }, { profile: { height: '171' } }, ['profile', 'height']],
        ['later array element changed', { sets: [1, 2, 3] }, { sets: [1, 2, 4] }, ['sets', '2']],
        ['later record field changed', { a: 1, b: 2 }, { a: 1, b: 3 }, ['b']],
        ['collection reordered', { rows: [{ id: 'a' }, { id: 'b' }] }, { rows: [{ id: 'b' }, { id: 'a' }] }, ['rows', '0', 'id']],
        ['root type changed', [], {}, []],
    ] as const)('reports the first lossy path: %s', (_, raw, normalized, expected) => {
        expect(findLossyNormalization(raw, normalized)).toEqual(expected);
    });

    it('permits schema defaults while preserving every existing array element and field', () => {
        const raw = { profile: { height: 170 }, rows: [{ id: 'a', enabled: 'false' }, { id: 'b', enabled: '1' }] };
        const normalized = {
            profile: { height: '170', optional: '' },
            rows: [{ id: 'a', enabled: false, count: 0 }, { id: 'b', enabled: true, count: 0 }],
            added: [],
        };
        const original = structuredClone(raw);
        const parsed = structuredClone(normalized);

        expect(findLossyNormalization(raw, normalized)).toBeNull();
        expect(raw).toEqual(original);
        expect(normalized).toEqual(parsed);
    });

    it('reports a nested mismatch with the supplied prefix without mutating that prefix', () => {
        const prefix = ['data'];
        expect(findLossyNormalization({ rows: [{ count: 1 }] }, { rows: [{ count: 2 }] }, prefix))
            .toEqual(['data', 'rows', '0', 'count']);
        expect(prefix).toEqual(['data']);
    });

    it('requires an own normalized field rather than an inherited substitute', () => {
        const normalized = Object.create({ height: '170' });
        expect(findLossyNormalization({ height: 170 }, normalized)).toEqual(['height']);
    });

    it('preserves own special keys from JSON instead of treating them as prototypes', () => {
        const raw: unknown = JSON.parse('{"__proto__":{"height":170}}');
        const normalized: unknown = JSON.parse('{"__proto__":{"height":"170"}}');
        expect(findLossyNormalization(raw, normalized)).toBeNull();
        expect(findLossyNormalization(raw, {})).toEqual(['__proto__']);
    });

    it('accepts a real Zod profile conversion at the cloud integrity boundary', () => {
        const raw = { profile: { height: 170 } };
        const normalized = { profile: UserProfileSchema.parse(raw.profile) };
        expect(normalized.profile.height).toBe('170');
        expect(() => assertCloudBusinessPreserved('', raw, normalized)).not.toThrow();
        expect(raw.profile.height).toBe(170);
    });

    it.each([
        ['invalid profile field', { height: { invalid: 'preserve-original' } }, 'profile.height'],
        ['primitive profile', 7, 'profile'],
        ['null profile', null, 'profile'],
    ] as const)('rejects a real Zod fallback for %s before accepting cloud data', (_, profile, path) => {
        const raw = { profile };
        const original = structuredClone(raw);
        const normalized = { profile: UserProfileSchema.parse(raw.profile) };
        expect(normalized.profile.height).toBeUndefined();
        expect(() => assertCloudBusinessPreserved('', raw, normalized)).toThrow(CloudDataIntegrityError);
        expect(() => assertCloudBusinessPreserved('', raw, normalized)).toThrow(path);
        expect(raw).toEqual(original);
    });
});
