import { describe, expect, it } from 'vitest';
import {
    CURRENT_DATA_SCHEMA,
    CURRENT_SYNC_PROTOCOL,
    FutureVersionError,
    LegacyVersionError,
    MissingMigrationError,
    assertCurrentVersion,
    migrateSequential,
    normalizeCloudDocument,
    withCurrentDataSchema,
    type CloudMigrationState,
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

    it('can migrate business data and causal field paths in the same pure step', () => {
        const source: CloudMigrationState = {
            business: { profile: { oldName: 'A' } },
            sync: {
                protocolVersion: 1,
                clock: { actor: 1 },
                fields: { 'profile/oldName': { actorId: 'actor', seq: 1, clock: { actor: 1 } } },
            },
        };

        const migrated = migrateSequential(source, 1, 2, {
            1: value => {
                const profile = value.business.profile as Record<string, unknown>;
                const sync = value.sync as any;
                const { oldName, ...restProfile } = profile;
                const oldStamp = sync.fields['profile/oldName'];
                const { ['profile/oldName']: _removed, ...restFields } = sync.fields;
                return {
                    business: { ...value.business, profile: { ...restProfile, name: oldName } },
                    sync: { ...sync, fields: { ...restFields, 'profile/name': oldStamp } },
                };
            },
        }, 'synthetic cloud schema');

        expect(migrated.business).toEqual({ profile: { name: 'A' } });
        expect((migrated.sync as any).fields['profile/name']).toBeDefined();
        expect(source.business).toEqual({ profile: { oldName: 'A' } });
        expect((source.sync as any).fields['profile/oldName']).toBeDefined();
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
        const raw = { profile: { name: 'A' }, _sync: { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: {} } };
        const normalized = normalizeCloudDocument(raw);
        expect(normalized.dataSchemaVersion).toBe(CURRENT_DATA_SCHEMA);
        expect(normalized.business).toEqual({ profile: { name: 'A' } });
        expect(normalized.sync).toEqual(raw._sync);
        expect(raw).toHaveProperty('_sync');
    });

    it('refuses a future Firestore data schema before business data is consumed', () => {
        expect(() => normalizeCloudDocument({ _schemaVersion: CURRENT_DATA_SCHEMA + 1, profile: { name: 'future' } }))
            .toThrow(FutureVersionError);
    });

    it('refuses a future sync protocol before semantic metadata is consumed', () => {
        expect(() => normalizeCloudDocument({
            profile: { name: 'future' },
            _sync: { protocolVersion: CURRENT_SYNC_PROTOCOL + 1, clock: {}, fields: {} },
        })).toThrow(FutureVersionError);
    });

    it('writes current schema and validates current sync protocol outside business data', () => {
        expect(withCurrentDataSchema({ profile: { name: 'A' } }, { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: {} }))
            .toEqual({
                profile: { name: 'A' },
                _schemaVersion: CURRENT_DATA_SCHEMA,
                _sync: { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: {} },
            });
    });
});
