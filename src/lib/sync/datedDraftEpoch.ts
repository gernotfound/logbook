import { readDeviceValueStrict, writeDeviceValue } from './deviceStorage';
import { assertWorkoutSnapshotEpoch, readDeviceConsentRevision } from './workoutDeviceIntent';

const SNAPSHOT_VERSION = 1;
const TAG = '__logbookDatedDraft';

type DatedDraftSnapshot = {
    __logbookDatedDraft: 1;
    owner: string;
    consentRevision: number;
    values: Record<string, string>;
};

export class UnverifiedDatedDraftEpochError extends Error {
    readonly code = 'dated-draft-consent-epoch-unverified';
    constructor(cause?: unknown) {
        super('Bozza locale di una generazione di consenso non verificabile: copia originale preservata.', { cause });
    }
}

function parseDraft(raw: string, owner: string): Record<string, string> {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Bozza locale non valida: originale preservato.');
    }
    const record = parsed as Record<string, unknown>;
    let data: unknown = parsed;
    let sourceRevision: number | undefined;
    if (Object.hasOwn(record, TAG)) {
        if (record.__logbookDatedDraft !== SNAPSHOT_VERSION || record.owner !== owner
            || !Number.isSafeInteger(record.consentRevision)
            || (record.consentRevision as number) < 1) {
            throw new Error('Provenienza della bozza locale non valida: originale preservato.');
        }
        sourceRevision = record.consentRevision as number;
        data = record.values;
    }
    try {
        assertWorkoutSnapshotEpoch(owner, sourceRevision);
    } catch (error) {
        throw new UnverifiedDatedDraftEpochError(error);
    }
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

/** Read value and exact plaintext record image from a single strict device read. */
export function readFencedDatedDraftImage(name: string, owner: string): DatedDraftImage {
    const raw = readDeviceValueStrict(name, owner);
    return { values: raw === null ? null : parseDraft(raw, owner), raw };
}

/** Copies from revoked generations are evidence, not current editing state. */
export function readFencedDatedDraft(name: string, owner: string): Record<string, string> | null {
    return readFencedDatedDraftImage(name, owner).values;
}

/**
 * Optional expectedRaw fences stale editors across observable cross-tab interleavings.
 * localStorage has no atomic compare-and-swap; simultaneous realm writes still need
 * independent witnesses or a serialization protocol for full race protection.
 */
export function writeFencedDatedDraft(
    name: string, owner: string, values: Record<string, string> | null, expectedRaw?: string | null,
): string | null {
    const current = readFencedDatedDraftImage(name, owner);
    if (expectedRaw !== undefined && current.raw !== expectedRaw) throw new DatedDraftConflictError();
    const revision = readDeviceConsentRevision(owner);
    if (values === null) {
        writeDeviceValue(name, null, owner);
        return null;
    }
    const payload: DatedDraftSnapshot | Record<string, string> =
        owner.startsWith('user:') && revision !== undefined
            ? { __logbookDatedDraft: SNAPSHOT_VERSION, owner, consentRevision: revision, values }
            : values;
    const raw = JSON.stringify(payload);
    writeDeviceValue(name, raw, owner);
    return raw;
}
