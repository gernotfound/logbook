const BASELINE_DATA_SCHEMA = 1 as const;
const BASELINE_SYNC_PROTOCOL = 3 as const;
const BASELINE_LOCAL_ENVELOPE = 5 as const;
const BASELINE_BACKUP_SCHEMA = 3 as const;

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

function assertVersionNumber(value: unknown, kind: string): number {
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

// Keep the first supported baseline distinct from the current version. Until
// real released data requires a migration, all intermediate versions fail closed.
function assertSupportedCurrentVersion(value: unknown, baseline: number, current: number, kind: string): number {
    const version = assertVersionNumber(value, kind);
    if (version < baseline) throw new LegacyVersionError(kind, version, baseline);
    return assertCurrentVersion(version, current, kind);
}

export type PersistedRecord = Record<string, unknown>;

export interface NormalizedCloudDocument {
    business: Record<string, unknown>;
    sync: unknown;
    dataSchemaVersion: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

function assertCurrentCloudSyncEnvelope(sync: unknown, kind: string): Record<string, unknown> {
    if (!isRecord(sync)) throw new Error(`${kind} non valido.`);
    const allowedKeys = new Set(['protocolVersion', 'clock', 'fields', 'writer']);
    if (Object.keys(sync).some(key => !allowedKeys.has(key))) throw new Error(`${kind}: campi non supportati.`);
    if (!isRecord(sync.clock)) throw new Error(`${kind}: clock non valido.`);
    if (!isRecord(sync.fields)) throw new Error(`${kind}: fields non valido.`);
    if (!isRecord(sync.writer)) throw new Error(`${kind}: writer obbligatorio.`);
    const writer = sync.writer;
    const allowedWriterKeys = new Set(['slot', 'replicaId', 'generation', 'seq', 'consentRevision']);
    if (Object.keys(writer).some(key => !allowedWriterKeys.has(key))) {
        throw new Error(`${kind}: writer contiene campi non supportati.`);
    }
    if (typeof writer.slot !== 'string' || !/^s(?:0[0-9]|1[0-5])$/.test(writer.slot)) {
        throw new Error(`${kind}: writer slot non valido.`);
    }
    if (typeof writer.replicaId !== 'string' || !writer.replicaId.trim() || writer.replicaId.length > 128) {
        throw new Error(`${kind}: writer replica non valido.`);
    }
    if (typeof writer.generation !== 'number' || !Number.isSafeInteger(writer.generation) || writer.generation < 1) {
        throw new Error(`${kind}: writer generation non valida.`);
    }
    if (typeof writer.seq !== 'number' || !Number.isSafeInteger(writer.seq) || writer.seq < 0) {
        throw new Error(`${kind}: writer seq non valida.`);
    }
    if (writer.consentRevision !== undefined && (
        typeof writer.consentRevision !== 'number'
        || !Number.isSafeInteger(writer.consentRevision) || writer.consentRevision < 0
    )) {
        throw new Error(`${kind}: writer consentRevision non valida.`);
    }
    return sync;
}

function normalizeSyncProtocol(sync: unknown, kind: string): Record<string, unknown> {
    if (!isRecord(sync)) throw new Error(`${kind} non valido.`);
    assertSupportedCurrentVersion(sync.protocolVersion, BASELINE_SYNC_PROTOCOL, CURRENT_SYNC_PROTOCOL, kind);
    return assertCurrentCloudSyncEnvelope(structuredClone(sync), kind);
}

function normalizePersistedDimensions(
    record: PersistedRecord,
    kind: string,
): PersistedRecord {
    assertSupportedCurrentVersion(record.dataSchemaVersion, BASELINE_DATA_SCHEMA, CURRENT_DATA_SCHEMA, `${kind} data schema`);
    assertSupportedCurrentVersion(record.syncProtocolVersion, BASELINE_SYNC_PROTOCOL, CURRENT_SYNC_PROTOCOL, `${kind} sync protocol`);
    return {
        ...structuredClone(record),
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
        assertSupportedCurrentVersion(raw._schemaVersion, BASELINE_DATA_SCHEMA, CURRENT_DATA_SCHEMA, kind);

        const { _schemaVersion: _ignoredVersion, _sync, ...business } = raw;
        if (_sync === undefined) {
            throw new LegacyVersionError(`${kind} sync protocol`, 0, BASELINE_SYNC_PROTOCOL);
        }
        const normalizedSync = normalizeSyncProtocol(_sync, `${kind} sync protocol`);

        return {
            business: structuredClone(business),
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
        assertSupportedCurrentVersion(raw.version, BASELINE_LOCAL_ENVELOPE, CURRENT_LOCAL_ENVELOPE, 'Formato archivio locale');
        return {
            ...normalizePersistedDimensions(raw, 'Archivio locale'),
            version: CURRENT_LOCAL_ENVELOPE,
        };
    } catch (error) {
        reportRuntimeUpdateRequired(error);
        throw error;
    }
}

export function normalizeBackupRecord(raw: unknown): PersistedRecord {
    if (!isRecord(raw)) throw new Error('Formato backup non valido.');
    assertSupportedCurrentVersion(raw.version, BASELINE_BACKUP_SCHEMA, CURRENT_BACKUP_SCHEMA, 'Formato backup');
    return {
        ...normalizePersistedDimensions(raw, 'Backup'),
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
        const normalizedSync = normalizeSyncProtocol(sync, 'Protocollo sync in scrittura');
        return {
            ...business,
            _schemaVersion: CURRENT_DATA_SCHEMA,
            _sync: normalizedSync,
        };
    } catch (error) {
        reportRuntimeUpdateRequired(error);
        throw error;
    }
}
