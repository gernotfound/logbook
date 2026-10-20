import { readDeviceValueStrict, writeDeviceValue } from './deviceStorage';
import { assertWorkoutSnapshotEpoch, readDeviceConsentRevision } from './workoutDeviceIntent';

const LEGACY_SNAPSHOT_VERSION = 1;
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

function newRevisionId(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

function parseDraft(raw: string, owner: string): Record<string, string> | null {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Bozza locale non valida: originale preservato.');
    }
    const record = parsed as Record<string, unknown>;
    let data: unknown = parsed;
    let sourceRevision: number | undefined;
    let tombstone = false;
    if (Object.hasOwn(record, TAG)) {
        const version = record[TAG];
        if ((version !== LEGACY_SNAPSHOT_VERSION && version !== SNAPSHOT_VERSION)
            || record.owner !== owner
            || (record.consentRevision !== undefined
                && (!Number.isSafeInteger(record.consentRevision)
                    || (record.consentRevision as number) < 1))
            || (version === LEGACY_SNAPSHOT_VERSION && record.consentRevision === undefined)
            || (version === SNAPSHOT_VERSION
                && (typeof record.revisionId !== 'string'
                    || !REVISION_PATTERN.test(record.revisionId)))) {
            throw new Error('Provenienza della bozza locale non valida: originale preservato.');
        }
        sourceRevision = record.consentRevision as number | undefined;
        data = record.values;
        tombstone = version === SNAPSHOT_VERSION && data === null;
    }
    try {
        // A current or previous consent's confirmed deletion carries no health
        // values. Its random revision still fences stale editors after clear.
        // Earlier *nonempty* drafts remain quarantined across consent changes.
        if (tombstone) readDeviceConsentRevision(owner);
        else assertWorkoutSnapshotEpoch(owner, sourceRevision);
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
export function readFencedDatedDraftImage(name: string, owner: string): DatedDraftImage {
    const raw = readDeviceValueStrict(name, owner);
    return { values: raw === null ? null : parseDraft(raw, owner), raw };
}

/** Copies from revoked generations are evidence, not current editing state. */
export function readFencedDatedDraft(name: string, owner: string): Record<string, string> | null {
    return readFencedDatedDraftImage(name, owner).values;
}

/**
 * Compare the observed image before the write. A random revision retained as
 * a tombstone after clear also rejects an absent→written→cleared ABA cycle.
 * localStorage still lacks atomic cross-realm CAS; independent witnesses are
 * required before simultaneous writes can be called lossless.
 */
export function writeFencedDatedDraft(
    name: string, owner: string, values: Record<string, string> | null, expectedRaw?: string | null,
): string {
    const current = readFencedDatedDraftImage(name, owner);
    if (expectedRaw !== undefined && current.raw !== expectedRaw) throw new DatedDraftConflictError();
    const revision = readDeviceConsentRevision(owner);
    const payload: DatedDraftSnapshot = {
        __logbookDatedDraft: SNAPSHOT_VERSION, owner, revisionId: newRevisionId(),
        ...(owner.startsWith('user:') && revision !== undefined ? { consentRevision: revision } : {}),
        values,
    };
    const raw = JSON.stringify(payload);
    // Unlike removing the key, this keeps a distinct revision after commit.
    // It is protected by the same owner-scoped AEAD device storage boundary.
    writeDeviceValue(name, raw, owner);
    return raw;
}
