export const BASELINE_DATA_SCHEMA = 1 as const;
export const BASELINE_SYNC_PROTOCOL = 3 as const;
export const BASELINE_LOCAL_ENVELOPE = 4 as const;
export const BASELINE_BACKUP_SCHEMA = 3 as const;

export const CURRENT_DATA_SCHEMA = 1 as const;
export const CURRENT_SYNC_PROTOCOL = 3 as const;
export const CURRENT_LOCAL_ENVELOPE = 5 as const;
export const CURRENT_BACKUP_SCHEMA = 3 as const;

export const UPDATE_REQUIRED_EVENT = 'logbook:update-required' as const;

export class FutureVersionError extends Error {
    readonly code = 'update-required';
    constructor(readonly kind: string, readonly found: number, readonly supported: number) {
        super(`${kind} ${found} non supportato: aggiorna TheLogBook (versione corrente ${supported}).`);
        this.name = 'FutureVersionError';
    }
}

export class LegacyVersionError extends Error {
    readonly code = 'legacy-version-unsupported';
    constructor(readonly kind: string, readonly found: number, readonly supported: number) {
        super(`${kind} ${found} non supportato dalla baseline corrente ${supported}.`);
        this.name = 'LegacyVersionError';
    }
}

export class MissingMigrationError extends Error {
    readonly code = 'missing-migration';
    constructor(readonly kind: string, readonly fromVersion: number) {
        super(`Migrazione ${kind} ${fromVersion}->${fromVersion + 1} mancante.`);
        this.name = 'MissingMigrationError';
    }
}

export function isUpdateRequiredError(error: unknown): boolean {
    const seen = new Set<unknown>();
    let current = error;
    while (current && typeof current === 'object' && !seen.has(current)) {
        seen.add(current);
        if (current instanceof FutureVersionError || (current as { code?: unknown }).code === 'update-required') return true;
        current = (current as { cause?: unknown }).cause;
    }
    return false;
}

function reportRuntimeUpdateRequired(error: unknown) {
    if (!isUpdateRequiredError(error) || typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
    window.dispatchEvent(new CustomEvent(UPDATE_REQUIRED_EVENT, { detail: error }));
}

export type Migration<T> = (value: Readonly<T>) => T;
export type MigrationRegistry<T> = Readonly<Record<number, Migration<T>>>;

export function assertVersionNumber(value: unknown, kind: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
        throw new Error(`${kind} non valido.`);
    }
    return value;
}

export function assertCurrentVersion(value: unknown, current: number, kind: string): number {
    const version = assertVersionNumber(value, kind);
    if (version > current) throw new FutureVersionError(kind, version, current);
    if (version < current) throw new LegacyVersionError(kind, version, current);
    return version;
}

export function migrateSequential<T>(
    value: T,
    fromVersion: number,
    currentVersion: number,
    registry: MigrationRegistry<T>,
    kind: string,
): T {
    let version = assertVersionNumber(fromVersion, kind);
    if (version > currentVersion) throw new FutureVersionError(kind, version, currentVersion);

    let current = structuredClone(value);
    while (version < currentVersion) {
        const migration = registry[version];
        if (!migration) throw new MissingMigrationError(kind, version);
        current = migration(structuredClone(current));
        version += 1;
    }
    return current;
}

export function migrateFromBaseline<T>(
    value: T,
    fromVersion: number,
    baselineVersion: number,
    currentVersion: number,
    registry: MigrationRegistry<T>,
    kind: string,
): T {
    const version = assertVersionNumber(fromVersion, kind);
    if (version < baselineVersion) throw new LegacyVersionError(kind, version, baselineVersion);
    return migrateSequential(value, version, currentVersion, registry, kind);
}

export interface CloudMigrationState {
    business: Record<string, unknown>;
    sync: unknown;
}

export type PersistedRecord = Record<string, unknown>;

export type DataMigrationCarrier =
    | { scope: 'cloud'; state: CloudMigrationState }
    | { scope: 'local-envelope'; record: PersistedRecord }
    | { scope: 'backup'; record: PersistedRecord };

export type SyncProtocolMigrationCarrier =
    | { scope: 'cloud'; sync: PersistedRecord }
    | { scope: 'local-envelope'; record: PersistedRecord }
    | { scope: 'backup'; record: PersistedRecord };

// Clean-cut pre-launch baseline: the first real account starts on the current persisted contracts.
// Future N->N+1 migrations are added only after a real released version has persisted user data.
// Data/sync migration steps receive a storage-scope carrier so one version dimension can advance
// independently of the local-envelope or backup container version without coupling those bumps.
export const DATA_MIGRATIONS: MigrationRegistry<DataMigrationCarrier> = {};
// Pre-launch clean cut: no real account data exists below Protocol 3.
// Future entries are added only for post-launch N->N+1 migrations.
export const SYNC_PROTOCOL_MIGRATIONS: MigrationRegistry<SyncProtocolMigrationCarrier> = {};
export const LOCAL_ENVELOPE_MIGRATIONS: MigrationRegistry<PersistedRecord> = {
    4: record => ({ ...structuredClone(record), replica: null }),
};
export const BACKUP_MIGRATIONS: MigrationRegistry<PersistedRecord> = {};

export interface NormalizedCloudDocument {
    business: Record<string, unknown>;
    sync: unknown;
    dataSchemaVersion: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

function readSyncProtocol(sync: unknown, kind: string): number | undefined {
    if (sync === undefined) return undefined;
    if (!isRecord(sync)) throw new Error(`${kind} non valido.`);
    const version = assertVersionNumber(sync.protocolVersion, kind);
    if (version < BASELINE_SYNC_PROTOCOL) throw new LegacyVersionError(kind, version, BASELINE_SYNC_PROTOCOL);
    if (version > CURRENT_SYNC_PROTOCOL) throw new FutureVersionError(kind, version, CURRENT_SYNC_PROTOCOL);
    return version;
}

function normalizeSyncProtocol(sync: unknown, sourceVersion: number | undefined, kind: string): unknown {
    if (sync === undefined || sourceVersion === undefined) return undefined;
    if (!isRecord(sync)) throw new Error(`${kind} non valido.`);
    const migrated = migrateFromBaseline<SyncProtocolMigrationCarrier>(
        { scope: 'cloud', sync: structuredClone(sync) },
        sourceVersion,
        BASELINE_SYNC_PROTOCOL,
        CURRENT_SYNC_PROTOCOL,
        SYNC_PROTOCOL_MIGRATIONS,
        kind,
    );
    if (migrated.scope !== 'cloud') throw new Error(`${kind}: migration scope non valido.`);
    return { ...migrated.sync, protocolVersion: CURRENT_SYNC_PROTOCOL };
}

function normalizePersistedDimensions(
    record: PersistedRecord,
    scope: 'local-envelope' | 'backup',
    kind: string,
): PersistedRecord {
    const sourceDataVersion = assertVersionNumber(record.dataSchemaVersion, `${kind} data schema`);
    const sourceSyncVersion = assertVersionNumber(record.syncProtocolVersion, `${kind} sync protocol`);

    const dataCarrier = migrateFromBaseline<DataMigrationCarrier>(
        { scope, record: structuredClone(record) },
        sourceDataVersion,
        BASELINE_DATA_SCHEMA,
        CURRENT_DATA_SCHEMA,
        DATA_MIGRATIONS,
        `${kind} data schema`,
    );
    if (dataCarrier.scope !== scope) throw new Error(`${kind}: data migration scope non valido.`);

    const syncCarrier = migrateFromBaseline<SyncProtocolMigrationCarrier>(
        { scope, record: structuredClone(dataCarrier.record) },
        sourceSyncVersion,
        BASELINE_SYNC_PROTOCOL,
        CURRENT_SYNC_PROTOCOL,
        SYNC_PROTOCOL_MIGRATIONS,
        `${kind} sync protocol`,
    );
    if (syncCarrier.scope !== scope) throw new Error(`${kind}: sync migration scope non valido.`);

    return {
        ...syncCarrier.record,
        dataSchemaVersion: CURRENT_DATA_SCHEMA,
        syncProtocolVersion: CURRENT_SYNC_PROTOCOL,
    };
}

export function normalizeCloudDocument(raw: unknown, kind = 'Firestore data schema'): NormalizedCloudDocument {
    try {
        if (!isRecord(raw)) throw new Error('Documento Firestore non valido.');

        if (raw._schemaVersion === undefined) {
            throw new LegacyVersionError(kind, 0, BASELINE_DATA_SCHEMA);
        }
        const sourceVersion = assertVersionNumber(raw._schemaVersion, kind);
        if (sourceVersion < BASELINE_DATA_SCHEMA) throw new LegacyVersionError(kind, sourceVersion, BASELINE_DATA_SCHEMA);
        if (sourceVersion > CURRENT_DATA_SCHEMA) throw new FutureVersionError(kind, sourceVersion, CURRENT_DATA_SCHEMA);

        const { _schemaVersion: _ignoredVersion, _sync, ...business } = raw;
        if (_sync === undefined) {
            throw new LegacyVersionError(`${kind} sync protocol`, 0, BASELINE_SYNC_PROTOCOL);
        }
        const sourceSyncVersion = readSyncProtocol(_sync, `${kind} sync protocol`);

        const migrated = migrateFromBaseline<DataMigrationCarrier>(
            {
                scope: 'cloud',
                state: { business: structuredClone(business), sync: _sync === undefined ? undefined : structuredClone(_sync) },
            },
            sourceVersion,
            BASELINE_DATA_SCHEMA,
            CURRENT_DATA_SCHEMA,
            DATA_MIGRATIONS,
            kind,
        );
        if (migrated.scope !== 'cloud') throw new Error(`${kind}: migration scope non valido.`);

        const normalizedSync = normalizeSyncProtocol(migrated.state.sync, sourceSyncVersion, `${kind} sync protocol`);

        return {
            business: migrated.state.business,
            sync: normalizedSync,
            dataSchemaVersion: CURRENT_DATA_SCHEMA,
        };
    } catch (error) {
        reportRuntimeUpdateRequired(error);
        throw error;
    }
}

export function normalizeLocalEnvelopeRecord(raw: unknown): PersistedRecord {
    try {
        if (!isRecord(raw)) throw new Error('Archivio locale non valido.');
        const sourceVersion = assertVersionNumber(raw.version, 'Formato archivio locale');
        const migrated = migrateFromBaseline(
            raw,
            sourceVersion,
            BASELINE_LOCAL_ENVELOPE,
            CURRENT_LOCAL_ENVELOPE,
            LOCAL_ENVELOPE_MIGRATIONS,
            'Formato archivio locale',
        );
        return {
            ...normalizePersistedDimensions(migrated, 'local-envelope', 'Archivio locale'),
            version: CURRENT_LOCAL_ENVELOPE,
        };
    } catch (error) {
        reportRuntimeUpdateRequired(error);
        throw error;
    }
}

export function normalizeBackupRecord(raw: unknown): PersistedRecord {
    if (!isRecord(raw)) throw new Error('Formato backup non valido.');
    const sourceVersion = assertVersionNumber(raw.version, 'Formato backup');
    const migrated = migrateFromBaseline(
        raw,
        sourceVersion,
        BASELINE_BACKUP_SCHEMA,
        CURRENT_BACKUP_SCHEMA,
        BACKUP_MIGRATIONS,
        'Formato backup',
    );
    return {
        ...normalizePersistedDimensions(migrated, 'backup', 'Backup'),
        version: CURRENT_BACKUP_SCHEMA,
    };
}

export function withCurrentDataSchema(
    business: Record<string, unknown>,
    sync?: unknown,
): Record<string, unknown> {
    try {
        if (sync === undefined) {
            throw new LegacyVersionError('Protocollo sync in scrittura', 0, BASELINE_SYNC_PROTOCOL);
        }
        const sourceSyncVersion = readSyncProtocol(sync, 'Protocollo sync in scrittura');
        const normalizedSync = normalizeSyncProtocol(sync, sourceSyncVersion, 'Protocollo sync in scrittura');
        return {
            ...business,
            _schemaVersion: CURRENT_DATA_SCHEMA,
            ...(normalizedSync === undefined ? {} : { _sync: normalizedSync }),
        };
    } catch (error) {
        reportRuntimeUpdateRequired(error);
        throw error;
    }
}
