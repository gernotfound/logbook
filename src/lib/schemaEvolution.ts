export const BASELINE_DATA_SCHEMA = 1 as const;
export const BASELINE_SYNC_PROTOCOL = 1 as const;
export const BASELINE_LOCAL_ENVELOPE = 4 as const;
export const BASELINE_BACKUP_SCHEMA = 3 as const;

export const CURRENT_DATA_SCHEMA = 1 as const;
export const CURRENT_SYNC_PROTOCOL = 1 as const;
export const CURRENT_LOCAL_ENVELOPE = 4 as const;
export const CURRENT_BACKUP_SCHEMA = 3 as const;

export class FutureVersionError extends Error {
    readonly code = 'update-required';
    constructor(readonly kind: string, readonly found: number, readonly supported: number) {
        super(`${kind} ${found} non supportato: aggiorna LogBook (versione corrente ${supported}).`);
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

// Clean-cut M1 baseline: no historical pre-M1 product migrations exist.
// Future N->N+1 migrations are added to these registries when the corresponding CURRENT_* constant is bumped.
export const DATA_MIGRATIONS: MigrationRegistry<CloudMigrationState> = {};
export const SYNC_PROTOCOL_MIGRATIONS: MigrationRegistry<PersistedRecord> = {};
export const LOCAL_ENVELOPE_MIGRATIONS: MigrationRegistry<PersistedRecord> = {};
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
    const migrated = migrateFromBaseline(
        sync,
        sourceVersion,
        BASELINE_SYNC_PROTOCOL,
        CURRENT_SYNC_PROTOCOL,
        SYNC_PROTOCOL_MIGRATIONS,
        kind,
    );
    return { ...migrated, protocolVersion: CURRENT_SYNC_PROTOCOL };
}

export function normalizeCloudDocument(raw: unknown, kind = 'Firestore data schema'): NormalizedCloudDocument {
    if (!isRecord(raw)) throw new Error('Documento Firestore non valido.');

    // Missing marker permanently means the schema-1 baseline, even after future schema bumps.
    const sourceVersion = raw._schemaVersion === undefined
        ? BASELINE_DATA_SCHEMA
        : assertVersionNumber(raw._schemaVersion, kind);

    const { _schemaVersion: _ignoredVersion, _sync, ...business } = raw;
    const sourceSyncVersion = readSyncProtocol(_sync, `${kind} sync protocol`);

    const migrated = migrateFromBaseline<CloudMigrationState>(
        { business: structuredClone(business), sync: _sync === undefined ? undefined : structuredClone(_sync) },
        sourceVersion,
        BASELINE_DATA_SCHEMA,
        CURRENT_DATA_SCHEMA,
        DATA_MIGRATIONS,
        kind,
    );

    const normalizedSync = normalizeSyncProtocol(migrated.sync, sourceSyncVersion, `${kind} sync protocol`);

    return {
        business: migrated.business,
        sync: normalizedSync,
        dataSchemaVersion: CURRENT_DATA_SCHEMA,
    };
}

export function normalizeLocalEnvelopeRecord(raw: unknown): PersistedRecord {
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
    return { ...migrated, version: CURRENT_LOCAL_ENVELOPE };
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
    return { ...migrated, version: CURRENT_BACKUP_SCHEMA };
}

export function withCurrentDataSchema(
    business: Record<string, unknown>,
    sync?: unknown,
): Record<string, unknown> {
    const sourceSyncVersion = readSyncProtocol(sync, 'Protocollo sync in scrittura');
    const normalizedSync = normalizeSyncProtocol(sync, sourceSyncVersion, 'Protocollo sync in scrittura');
    return {
        ...business,
        _schemaVersion: CURRENT_DATA_SCHEMA,
        ...(normalizedSync === undefined ? {} : { _sync: normalizedSync }),
    };
}
