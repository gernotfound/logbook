import { getArchiveRecord, updateArchiveRecord } from './secureArchiveRepository';
import { ownerConsentRevision } from './localConsentReconciliation';
import { UserDataSchema } from '../schema';
import type { UserData } from '../../types';
import { generateId } from '../utils/date';
import { normalizeStorageOwner } from './owner';
import { validateLocalEnvelope, type LocalEnvelope } from './localEnvelopeValidation';
import { CURRENT_DATA_SCHEMA, CURRENT_LOCAL_ENVELOPE, CURRENT_SYNC_PROTOCOL } from '../schemaEvolution';

const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;

const currentEnvelopeVersions = () => ({
    version: CURRENT_LOCAL_ENVELOPE,
    dataSchemaVersion: CURRENT_DATA_SCHEMA,
    syncProtocolVersion: CURRENT_SYNC_PROTOCOL,
});

/** Migration-only read verifier. Enforces the full existing causal/schema contract. */
export function assertLegacyEnvelopeValidForSecureMigration(raw: unknown, owner: string): void {
    if (raw === undefined) return;
    if (!validateLocalEnvelope(raw, normalizeStorageOwner(owner))) {
        throw new Error('Archivio legacy non valido: migrazione sospesa senza modificare il dato.');
    }
}

export async function readLocal(owner: string): Promise<LocalEnvelope | undefined> {
    owner = normalizeStorageOwner(owner);
    return validateLocalEnvelope(await getArchiveRecord<any>(owner), owner);
}

export async function initializeLocal(owner: string, data: UserData, completeMonths?: string[], guard?: () => boolean): Promise<void> {
    owner = normalizeStorageOwner(owner);
    const parsed = structuredClone(parse(data));
    await updateArchiveRecord<any>(owner, raw => {
        if (guard && !guard()) throw new Error('Inizializzazione locale invalidata dal cambio sessione');
        const current = validateLocalEnvelope(raw, owner);
        // Bootstrap is create-if-absent, not a replacement write: the journal
        // can be empty (especially for guest or an acknowledged account) while
        // a concurrent tab has already committed durable business edits.
        if (current) return current;
        return { ...currentEnvelopeVersions(), ...ownerConsentRevision(owner), owner, actorId: generateId('actor'), actorSeq: 0, clock: {}, data: parsed, baseline: parsed, completeMonths: completeMonths ?? [], pending: [], syncMetaByDocument: {}, replica: null, revision: 0 };
    });
}

