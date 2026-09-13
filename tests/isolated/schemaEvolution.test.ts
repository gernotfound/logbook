import { describe, expect, it } from 'vitest';
import {
    CURRENT_DATA_SCHEMA,
    FutureVersionError,
    LegacyVersionError,
    MissingMigrationError,
    assertCurrentVersion,
    migrateSequential,
    normalizeCloudDocument,
    withCurrentDataSchema,
} from '../../src/lib/schemaEvolution';

describe('Schema Evolution registry', () => {
    it('runs migrations sequentially without mutating the source', () => {
        const source = { value: 1, nested: { seen: [] as number[] } };
        const result = migrateSequential(
            source,
            1,
            3,
            {
                1: value => ({ ...value, value: value.value + 1, nested: { seen: [...value.nested.seen, 1] } }),
                2: value => ({ ...value, value: value.value * 10, nested: { seen: [...value.nested.seen, 2] } }),
            },
            'test schema',
        );

        expect(result).toEqual({ value: 20, nested: { seen: [1, 2] } });
        expect(source).toEqual({ value: 1, nested: { seen: [] } });
    });

    it('fails closed when a sequential migration step is missing', () => {
        expect(() => migrateSequential({ value: 1 }, 1, 3, { 1: value => ({ ...value, value: 2 }) }, 'test schema'))
            .toThrow(MissingMigrationError);
    });

    it('refuses future and legacy current-only formats explicitly', () => {
        expect(() => assertCurrentVersion(2, 1, 'schema')).toThrow(FutureVersionError);
        expect(() => assertCurrentVersion(1, 2, 'schema')).toThrow(LegacyVersionError);
    });

    it('treats an unversioned Firestore document as the clean schema-1 baseline', () => {
        const raw = { profile: { name: 'A' }, _sync: { protocolVersion: 1, clock: {}, fields: {} } };
        const normalized = normalizeCloudDocument(raw);
        expect(normalized.dataSchemaVersion).toBe(CURRENT_DATA_SCHEMA);
        expect(normalized.business).toEqual({ profile: { name: 'A' } });
        expect(normalized.sync).toEqual(raw._sync);
        expect(raw).toHaveProperty('_sync');
    });

    it('refuses a future Firestore schema before business data is consumed', () => {
        expect(() => normalizeCloudDocument({ _schemaVersion: CURRENT_DATA_SCHEMA + 1, profile: { name: 'future' } }))
            .toThrow(FutureVersionError);
    });

    it('writes the current data marker outside business data', () => {
        expect(withCurrentDataSchema({ profile: { name: 'A' } }, { protocolVersion: 1, clock: {}, fields: {} }))
            .toEqual({
                profile: { name: 'A' },
                _schemaVersion: CURRENT_DATA_SCHEMA,
                _sync: { protocolVersion: 1, clock: {}, fields: {} },
            });
    });
});
