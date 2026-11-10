import { describe, expect, it } from 'vitest';
import {
    CURRENT_DATA_SCHEMA,
    CURRENT_SYNC_PROTOCOL,
    FutureVersionError,
    LegacyVersionError,
    assertCurrentVersion,
    normalizeBackupRecord,
    normalizeCloudDocument,
    normalizeLocalEnvelopeRecord,
    withCurrentDataSchema,
} from '../../src/lib/schemaEvolution';

describe('Schema Evolution registry', () => {
    it('keeps accepted current-format records detached from authenticated input', () => {
        const local = {
            version: 5, dataSchemaVersion: CURRENT_DATA_SCHEMA, syncProtocolVersion: CURRENT_SYNC_PROTOCOL,
            data: { profile: { name: 'original' } }, pending: [{ seq: 1 }],
        };
        const normalizedLocal = normalizeLocalEnvelopeRecord(local);
        expect(normalizedLocal).toEqual(local);
        expect(normalizedLocal).not.toBe(local);
        expect(normalizedLocal.data).not.toBe(local.data);
        ((normalizedLocal.data as { profile: { name: string } }).profile).name = 'edited';
        expect(local.data.profile.name).toBe('original');

        const backup = { version: 3, dataSchemaVersion: CURRENT_DATA_SCHEMA,
            syncProtocolVersion: CURRENT_SYNC_PROTOCOL, userData: { profile: { name: 'original' } } };
        const normalizedBackup = normalizeBackupRecord(backup);
        expect(normalizedBackup).toEqual(backup);
        ((normalizedBackup.userData as { profile: { name: string } }).profile).name = 'edited';
        expect(backup.userData.profile.name).toBe('original');

        const sync = { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: { s00: 2 }, fields: {},
            writer: { slot: 's00', replicaId: 'replica', generation: 1, seq: 2 } };
        const cloud = { profile: { name: 'original' }, _schemaVersion: CURRENT_DATA_SCHEMA, _sync: sync };
        const normalizedCloud = normalizeCloudDocument(cloud);
        (normalizedCloud.business.profile as { name: string }).name = 'edited';
        (normalizedCloud.sync as { clock: { s00: number } }).clock.s00 = 9;
        expect(cloud.profile.name).toBe('original');
        expect(sync.clock.s00).toBe(2);
    });

    it('rejects unsupported versions independently in local and backup containers', () => {
        for (const [normalize, version] of [
            [normalizeLocalEnvelopeRecord, 5],
            [normalizeBackupRecord, 3],
        ] as const) {
            const supported = {
                version,
                dataSchemaVersion: CURRENT_DATA_SCHEMA,
                syncProtocolVersion: CURRENT_SYNC_PROTOCOL,
                payload: { value: 'unchanged' },
            };
            const cases = [
                { change: { version: version - 1 }, error: LegacyVersionError },
                { change: { version: version + 1 }, error: FutureVersionError },
                { change: { dataSchemaVersion: CURRENT_DATA_SCHEMA + 1 }, error: FutureVersionError },
                { change: { syncProtocolVersion: CURRENT_SYNC_PROTOCOL + 1 }, error: FutureVersionError },
                { change: { syncProtocolVersion: CURRENT_SYNC_PROTOCOL - 1 }, error: LegacyVersionError },
            ];
            for (const { change, error } of cases) {
                const original = { ...supported, ...change };
                const snapshot = structuredClone(original);
                expect(() => normalize(original)).toThrow(error);
                expect(original).toEqual(snapshot);
            }
        }
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
                version: 5,
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

    it('rejects pre-launch Local Envelope 4 even when the nested schema and sync protocol are current', () => {
        const obsolete = {
            version: 4,
            dataSchemaVersion: CURRENT_DATA_SCHEMA,
            syncProtocolVersion: CURRENT_SYNC_PROTOCOL,
            owner: 'user:a', actorId: 'actor', actorSeq: 0, clock: {},
            data: {}, baseline: {}, completeMonths: [], pending: [],
            syncMetaByDocument: {}, revision: 0,
        };
        expect(() => normalizeLocalEnvelopeRecord(obsolete)).toThrow(LegacyVersionError);
        expect(obsolete.version).toBe(4);
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

        expect(() => normalizeCloudDocument({
            profile: { name: 'A' },
            _schemaVersion: CURRENT_DATA_SCHEMA,
            _sync: {
                protocolVersion: CURRENT_SYNC_PROTOCOL,
                clock: {},
                fields: {},
                writer: { slot: 's00', replicaId: 'test-replica', generation: 1, seq: 0, legacy: true },
            },
        })).toThrow('writer contiene campi non supportati');
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
