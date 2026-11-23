import type { DatedDraftStorage } from './datedDraftStorage';
import { newWriterRevisionId } from './writerLineage';

const SNAPSHOT_VERSION = 2;
const TAG = '__logbookDatedDraft';
const REVISION_PATTERN = /^[a-f0-9]{32}$/;

type DatedDraftSnapshot = {
    __logbookDatedDraft: 2;
    owner: string;
    consentRevision?: number;
    revisionId: string;
    values: Record<string, string> | null;
};

export class UnverifiedDatedDraftEpochError extends Error {
    readonly code = 'dated-draft-consent-epoch-unverified';
    constructor(cause?: unknown) {
        super('Bozza locale di una generazione di consenso non verificabile: copia originale preservata.', { cause });
    }
}

function parseDraft(raw: string, owner: string, storage: DatedDraftStorage): Record<string, string> | null {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Bozza locale non valida: originale preservato.');
    }
    const record = parsed as Record<string, unknown>;
    // Account drafts written by the current baseline always carry an origin
    // epoch. An unmarked draft cannot prove consent provenance, even at epoch 1.
    if (record[TAG] !== SNAPSHOT_VERSION
        || record.owner !== owner
        || (owner.startsWith('user:') && record.consentRevision === undefined)
        || (record.consentRevision !== undefined
            && (!Number.isSafeInteger(record.consentRevision)
                || (record.consentRevision as number) < 1))
        || typeof record.revisionId !== 'string'
        || !REVISION_PATTERN.test(record.revisionId)) {
        throw new Error('Provenienza della bozza locale non valida: originale preservato.');
    }
    const sourceRevision = record.consentRevision as number | undefined;
    const data: unknown = record.values;
    const tombstone = data === null;
    try {
        // A current or previous consent's confirmed deletion carries no health
        // values. Its random revision still fences stale editors after clear.
        // Earlier *nonempty* drafts remain quarantined across consent changes.
        const revision = storage.readRevision();
        if (!tombstone && owner.startsWith('user:') && sourceRevision !== revision) {
            throw new Error('Bozza di una generazione di consenso precedente.');
        }
    } catch (error) {
        throw new UnverifiedDatedDraftEpochError(error);
    }
    if (tombstone) return null;
    if (!data || typeof data !== 'object' || Array.isArray(data)
        || Object.entries(data).some(([, value]) => typeof value !== 'string')) {
        throw new Error('Contenuto della bozza locale non valido: originale preservato.');
    }
    return data as Record<string, string>;
}

export class DatedDraftConflictError extends Error {
    readonly code = 'dated-draft-concurrent-edit';
    constructor() {
        super('Bozza modificata da un’altra scheda: originale conservato. Riapri TheLogBook per ricaricare la copia più recente.');
        this.name = 'DatedDraftConflictError';
    }
}

export type DatedDraftImage = { values: Record<string, string> | null; raw: string | null };

/** Read the exact plaintext record image; a deletion marker has null values but a non-null raw revision. */
export function readFencedDatedDraftImage(
    name: string, owner: string, storage: DatedDraftStorage,
): DatedDraftImage {
    const raw = storage.read(name);
    return { values: raw === null ? null : parseDraft(raw, owner, storage), raw };
}

/**
 * Compare the observed image before the write. A random revision retained as
 * a tombstone after clear also rejects an absent→written→cleared ABA cycle.
 * localStorage still lacks atomic cross-realm CAS; independent witnesses are
 * required before simultaneous writes can be called lossless.
 */
export function writeFencedDatedDraft(
    name: string, owner: string, values: Record<string, string> | null, expectedRaw: string | null | undefined,
    storage: DatedDraftStorage,
): string {
    const current = readFencedDatedDraftImage(name, owner, storage);
    if (expectedRaw !== undefined && current.raw !== expectedRaw) throw new DatedDraftConflictError();
    const revision = storage.readRevision();
    if (owner.startsWith('user:') && revision === undefined) {
        // Do not publish an unstamped value or deletion marker when consent
        // provenance is unavailable. Leave the original device copy intact.
        throw new UnverifiedDatedDraftEpochError();
    }
    const payload: DatedDraftSnapshot = {
        __logbookDatedDraft: SNAPSHOT_VERSION, owner, revisionId: newWriterRevisionId(),
        ...(owner.startsWith('user:') && revision !== undefined ? { consentRevision: revision } : {}),
        values,
    };
    const raw = JSON.stringify(payload);
    // Unlike removing the key, this keeps a distinct revision after commit.
    // It is protected by the same owner-scoped AEAD device storage boundary.
    storage.write(name, raw, current.raw);
    return raw;
}
