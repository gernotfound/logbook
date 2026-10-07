import { describe, expect, it } from 'vitest';
import {
    CURRENT_DATA_SCHEMA,
    CURRENT_SYNC_PROTOCOL,
    FutureVersionError,
    LegacyVersionError,
    MissingMigrationError,
    assertCurrentVersion,
    migrateSequential,
    normalizeBackupRecord,
    normalizeCloudDocument,
    normalizeLocalEnvelopeRecord,
    withCurrentDataSchema,
    type CloudMigrationState,
    type DataMigrationCarrier,
    type SyncProtocolMigrationCarrier,
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

    it('lets data and sync dimensions advance without bumping local/backup container versions', () => {
        for (const scope of ['local-envelope', 'backup'] as const) {
            const source: DataMigrationCarrier = {
                scope,
                record: {
                    version: scope === 'local-envelope' ? 4 : 3,
                    dataSchemaVersion: 1,
                    syncProtocolVersion: 1,
                    payload: { oldName: 'A' },
                },
            };

            const dataMigrated = migrateSequential<DataMigrationCarrier>(source, 1, 2, {
                1: value => {
                    if (value.scope === 'cloud') return structuredClone(value) as DataMigrationCarrier;
                    const payload = value.record.payload as Record<string, unknown>;
                    return {
                        scope: value.scope,
                        record: { ...value.record, payload: { name: payload.oldName } },
                    };
                },
            }, `${scope} synthetic data schema`);

            expect(dataMigrated.scope).toBe(scope);
            if (dataMigrated.scope === 'cloud') throw new Error('Unexpected cloud carrier');
            expect(dataMigrated.record.version).toBe(scope === 'local-envelope' ? 4 : 3);
            expect(dataMigrated.record.payload).toEqual({ name: 'A' });

            const syncSource: SyncProtocolMigrationCarrier = { scope, record: dataMigrated.record };
            const syncMigrated = migrateSequential<SyncProtocolMigrationCarrier>(syncSource, 1, 2, {
                1: value => value.scope === 'cloud'
                    ? structuredClone(value) as SyncProtocolMigrationCarrier
                    : { scope: value.scope, record: { ...value.record, syncMarker: 'migrated' } },
            }, `${scope} synthetic sync protocol`);

            expect(syncMigrated.scope).toBe(scope);
            if (syncMigrated.scope === 'cloud') throw new Error('Unexpected cloud carrier');
            expect(syncMigrated.record.version).toBe(scope === 'local-envelope' ? 4 : 3);
            expect(syncMigrated.record.syncMarker).toBe('migrated');
        }
    });

    it('fails closed when a sequential migration step is missing', () => {
        expect(() => migrateSequential({ value: 1 }, 1, 3, { 1: value => ({ ...value, value: 2 }) }, 'test schema'))
            .toThrow(MissingMigrationError);
    });

    it('refuses future and legacy current-only formats explicitly', () => {
        expect(() => assertCurrentVersion(2, 1, 'schema')).toThrow(FutureVersionError);
        expect(() => assertCurrentVersion(1, 2, 'schema')).toThrow(LegacyVersionError);
    });

    it('rejects pre-launch sync protocols instead of migrating them into the first real account baseline', () => {
        for (const protocolVersion of [1, 2]) {
            expect(() => normalizeCloudDocument({
                profile: { name: 'legacy' },
                _schemaVersion: CURRENT_DATA_SCHEMA,
                _sync: { protocolVersion, clock: {}, fields: {} },
            })).toThrow(LegacyVersionError);

            expect(() => normalizeLocalEnvelopeRecord({
                version: 4,
                dataSchemaVersion: CURRENT_DATA_SCHEMA,
                syncProtocolVersion: protocolVersion,
                owner: 'user:a',
                actorId: 'A',
                actorSeq: 0,
                clock: {},
                data: {},
                baseline: {},
                completeMonths: [],
                pending: [],
                syncMetaByDocument: {},
                revision: 0,
            })).toThrow(LegacyVersionError);

            expect(() => normalizeBackupRecord({
                format: 'logbook-backup',
                version: 3,
                dataSchemaVersion: CURRENT_DATA_SCHEMA,
                syncProtocolVersion: protocolVersion,
                type: 'backup',
                owner: 'user:a',
                userData: {},
            })).toThrow(LegacyVersionError);
        }
    });

    it('rejects persisted Firestore documents missing the current schema or sync markers', () => {
        expect(() => normalizeCloudDocument({
            profile: { name: 'A' },
            _sync: { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: {}, writer: { slot: 's00', replicaId: 'test-replica', generation: 1, seq: 0 } },
        })).toThrow(LegacyVersionError);

        expect(() => normalizeCloudDocument({
            profile: { name: 'A' },
            _schemaVersion: CURRENT_DATA_SCHEMA,
        })).toThrow(LegacyVersionError);

        expect(() => normalizeCloudDocument({
            profile: { name: 'A' },
            _schemaVersion: CURRENT_DATA_SCHEMA,
            _sync: { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: {} },
        })).toThrow('writer obbligatorio');
    });

    it('refuses a future Firestore data schema before business data is consumed', () => {
        expect(() => normalizeCloudDocument({
            _schemaVersion: CURRENT_DATA_SCHEMA + 1,
            profile: { name: 'future' },
            _sync: { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: {}, writer: { slot: 's00', replicaId: 'test-replica', generation: 1, seq: 0 } },
        })).toThrow(FutureVersionError);
    });

    it('refuses a future sync protocol before semantic metadata is consumed', () => {
        expect(() => normalizeCloudDocument({
            profile: { name: 'future' },
            _schemaVersion: CURRENT_DATA_SCHEMA,
            _sync: { protocolVersion: CURRENT_SYNC_PROTOCOL + 1, clock: {}, fields: {} },
        })).toThrow(FutureVersionError);
    });

    it('writes current schema and validates current sync protocol outside business data', () => {
        expect(withCurrentDataSchema({ profile: { name: 'A' } }, { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: {}, writer: { slot: 's00', replicaId: 'test-replica', generation: 1, seq: 0 } }))
            .toEqual({
                profile: { name: 'A' },
                _schemaVersion: CURRENT_DATA_SCHEMA,
                _sync: { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: {}, writer: { slot: 's00', replicaId: 'test-replica', generation: 1, seq: 0 } },
            });
    });
});
