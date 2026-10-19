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

/** Copies from revoked generations are evidence, not current editing state. */
export function readFencedDatedDraft(name: string, owner: string): Record<string, string> | null {
    const raw = readDeviceValueStrict(name, owner);
    return raw === null ? null : parseDraft(raw, owner);
}

/** Validate the old record before either overwriting or deleting it. */
export function writeFencedDatedDraft(
    name: string, owner: string, values: Record<string, string> | null,
): void {
    readFencedDatedDraft(name, owner);
    const revision = readDeviceConsentRevision(owner);
    if (values === null) {
        writeDeviceValue(name, null, owner);
        return;
    }
    const payload: DatedDraftSnapshot | Record<string, string> =
        owner.startsWith('user:') && revision !== undefined
            ? { __logbookDatedDraft: SNAPSHOT_VERSION, owner, consentRevision: revision, values }
            : values;
    writeDeviceValue(name, JSON.stringify(payload), owner);
}
