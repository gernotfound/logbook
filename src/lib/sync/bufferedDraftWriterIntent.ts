import { deviceKey, readDeviceValueStrict, writeDeviceValue } from './deviceStorage';
import { readDeviceConsentRevision, assertWorkoutSnapshotEpoch } from './workoutDeviceIntent';

const INTENT_PREFIX = 'draft:buffered-intent:';

type BufferedWriterIntent = {
    __logbookBufferedWriterIntent: 1;
    owner: string;
    draftName: string;
    value: string;
    consentRevision?: number;
};

export type BufferedWriterEvidence = { name: string; raw: string; value: string };

/** Each editor gets a distinct synchronous device key; no shared CAS is needed to protect its own latest input. */
export function createBufferedWriterIntentName(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return INTENT_PREFIX + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function parseWriterEvidence(
    name: string, owner: string, raw: string, validateEpoch = true,
): BufferedWriterEvidence & { revision?: number } {
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new Error('Intenzione bozza non valida: originale conservato.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Intenzione bozza senza provenienza: originale conservato.');
    }
    const record = value as Partial<BufferedWriterIntent>;
    if (record.__logbookBufferedWriterIntent !== 1 || record.owner !== owner
        || typeof record.draftName !== 'string' || !record.draftName.startsWith('draft:buffered:')
        || typeof record.value !== 'string'
        || (record.consentRevision !== undefined
            && (!Number.isSafeInteger(record.consentRevision) || record.consentRevision < 1))) {
        throw new Error('Metadati intenzione bozza non validi: originale conservato.');
    }
    if (validateEpoch) assertWorkoutSnapshotEpoch(owner, record.consentRevision);
    return { name, raw, value: record.value, revision: record.consentRevision };
}

/** 
 * Enumerate both encrypted and pre-vault owner namespaces, never another owner.
 * Ambiguous/orphaned writers must be exported explicitly, not auto-selected.
 */
export function readBufferedWriterEvidence(owner: string, draftName: string): BufferedWriterEvidence[] {
    const ownerPrefix = deviceKey('', owner);
    const names = new Set<string>();
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith(ownerPrefix)) continue;
        const suffix = key.slice(ownerPrefix.length);
        const name = suffix.startsWith('sealed:') ? suffix.slice('sealed:'.length) : suffix;
        if (name.startsWith(INTENT_PREFIX)) names.add(name);
    }
    const matches: BufferedWriterEvidence[] = [];
    for (const name of names) {
        const raw = readDeviceValueStrict(name, owner);
        if (raw === null) throw new Error('Intenzione bozza scomparsa durante la lettura.');
        // Check provenance only for this field. A valid older-epoch witness
        // for an unrelated field must remain exportable without blocking edits here.
        // Malformed/unknown-owner records still fail closed before filtering.
        const evidence = parseWriterEvidence(name, owner, raw, false);
        const record = JSON.parse(raw) as BufferedWriterIntent;
        if (record.draftName === draftName) {
            assertWorkoutSnapshotEpoch(owner, evidence.revision);
            matches.push(evidence);
            if (matches.length > 64) throw new Error('Troppe bozze concorrenti: esportazione di recupero necessaria.');
        }
    }
    return matches;
}

function checkConsent(owner: string, expectedConsentGeneration?: string | null): number | undefined {
    const revision = readDeviceConsentRevision(owner);
    if (owner.startsWith('user:') && expectedConsentGeneration !== undefined
        && expectedConsentGeneration !== (revision === undefined ? null : String(revision))) {
        throw new Error('Generazione di consenso cambiata: intenzione bozza conservata.');
    }
    return revision;
}

/**
 * Synchronously preserve this editor's latest value BEFORE attempting any shared-key update.
 * Writers in different tabs use different keys even if they read the same shared image.
 */
export function writeBufferedWriterIntent(
    name: string, owner: string, draftName: string, value: string,
    expectedRaw: string | null, expectedConsentGeneration?: string | null,
): string {
    if (!name.startsWith(INTENT_PREFIX) || !draftName.startsWith('draft:buffered:')) {
        throw new Error('Identità intenzione bozza non valida.');
    }
    const current = readDeviceValueStrict(name, owner);
    if (current !== expectedRaw) throw new Error('Intenzione bozza modificata esternamente: copia conservata.');
    if (current !== null) {
        const evidence = parseWriterEvidence(name, owner, current);
        const parsed = JSON.parse(evidence.raw) as BufferedWriterIntent;
        if (parsed.draftName !== draftName) throw new Error('Intenzione bozza associata a un altro campo.');
    }
    const revision = checkConsent(owner, expectedConsentGeneration);
    const raw = JSON.stringify({
        __logbookBufferedWriterIntent: 1, owner, draftName, value,
        ...(owner.startsWith('user:') && revision !== undefined ? { consentRevision: revision } : {}),
    } satisfies BufferedWriterIntent);
    writeDeviceValue(name, raw, owner);
    return raw;
}

export function clearBufferedWriterIntent(
    name: string, owner: string, expectedRaw: string, expectedConsentGeneration?: string | null,
): void {
    if (!name.startsWith(INTENT_PREFIX)) throw new Error('Identità intenzione bozza non valida.');
    const current = readDeviceValueStrict(name, owner);
    if (current !== expectedRaw) throw new Error('Intenzione bozza diversa: originale conservato.');
    parseWriterEvidence(name, owner, current);
    checkConsent(owner, expectedConsentGeneration);
    writeDeviceValue(name, null, owner);
}
