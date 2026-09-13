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

export interface CloudMigrationState {
    business: Record<string, unknown>;
    sync: unknown;
}

// Clean-cut M1 baseline: there are deliberately no historical product migrations.
// Add future N->N+1 steps here when CURRENT_DATA_SCHEMA is bumped.
export const DATA_MIGRATIONS: MigrationRegistry<CloudMigrationState> = {};

export interface NormalizedCloudDocument {
    business: Record<string, unknown>;
    sync: unknown;
    dataSchemaVersion: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

function validateSyncProtocol(sync: unknown, kind: string): void {
    if (sync === undefined) return;
    if (!isRecord(sync)) throw new Error(`${kind} non valido.`);
    assertCurrentVersion(sync.protocolVersion, CURRENT_SYNC_PROTOCOL, kind);
}

export function normalizeCloudDocument(raw: unknown, kind = 'Firestore data schema'): NormalizedCloudDocument {
    if (!isRecord(raw)) throw new Error('Documento Firestore non valido.');

    // Unversioned documents are the schema-1 baseline. No historical migration is performed.
    const sourceVersion = raw._schemaVersion === undefined
        ? CURRENT_DATA_SCHEMA
        : assertVersionNumber(raw._schemaVersion, kind);

    const { _schemaVersion: _ignoredVersion, _sync, ...business } = raw;
    validateSyncProtocol(_sync, `${kind} sync protocol`);

    const migrated = migrateSequential<CloudMigrationState>(
        { business: structuredClone(business), sync: _sync === undefined ? undefined : structuredClone(_sync) },
        sourceVersion,
        CURRENT_DATA_SCHEMA,
        DATA_MIGRATIONS,
        kind,
    );
    validateSyncProtocol(migrated.sync, `${kind} migrated sync protocol`);

    return {
        business: migrated.business,
        sync: migrated.sync,
        dataSchemaVersion: CURRENT_DATA_SCHEMA,
    };
}

export function withCurrentDataSchema(
    business: Record<string, unknown>,
    sync?: unknown,
): Record<string, unknown> {
    validateSyncProtocol(sync, 'Protocollo sync in scrittura');
    return {
        ...business,
        _schemaVersion: CURRENT_DATA_SCHEMA,
        ...(sync === undefined ? {} : { _sync: sync }),
    };
}
