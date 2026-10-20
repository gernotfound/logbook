import { deviceKey, readDeviceValueStrict, writeDeviceValue } from './deviceStorage';
import { readDeviceConsentRevision, assertWorkoutSnapshotEpoch } from './workoutDeviceIntent';
import { stableStorageKeyInventory } from './stableStorageKeyInventory';

const INTENT_PREFIX = 'draft:buffered-intent:';

type BufferedWriterIntent = {
    __logbookBufferedWriterIntent: 1;
    owner: string;
    draftName: string;
    value: string;
    consentRevision?: number;
};

export type BufferedWriterEvidence = { name: string; raw: string; value: string };
export type BufferedRecoveryEntry = {
    name: string;
    draftName: string;
    value: string;
    consentRevision: number | null;
    provenance: 'current' | 'previous' | 'unknown' | 'guest';
};

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
function ownerWriterNames(owner: string): Set<string> {
    const ownerPrefix = deviceKey('', owner);
    const names = new Set<string>();
    const inventory = stableStorageKeyInventory('Inventario copie bufferizzate modificato durante la lettura.');
    for (const key of inventory) {
        if (!key.startsWith(ownerPrefix)) continue;
        const suffix = key.slice(ownerPrefix.length);
        const name = suffix.startsWith('sealed:') ? suffix.slice('sealed:'.length) : suffix;
        if (name.startsWith(INTENT_PREFIX)) names.add(name);
    }
    return names;
}

/** Explicit diagnostics only; never promote, clear, re-label or commit a witness. */
export function inspectBufferedRecoveryEvidence(owner: string): BufferedRecoveryEntry[] {
    const names = ownerWriterNames(owner);
    if (names.size > 1024) throw new Error('Troppe copie per l’anteprima: conserva il Backup JSON.');
    const revision = readDeviceConsentRevision(owner);
    const scanned: (BufferedRecoveryEntry & { raw: string })[] = [];
    let total = 0;
    for (const name of names) {
        const raw = readDeviceValueStrict(name, owner);
        if (raw === null) throw new Error('Copia scomparsa durante la verifica.');
        const parsed = parseWriterEvidence(name, owner, raw, false);
        const draftName = (JSON.parse(raw) as BufferedWriterIntent).draftName;
        total += parsed.value.length;
        if (parsed.value.length > 100_000 || total > 1_000_000) {
            throw new Error('Copie troppo grandi per l’anteprima: conserva il Backup JSON.');
        }
        const provenance: BufferedRecoveryEntry['provenance'] = owner === 'guest' ? 'guest'
            : parsed.revision === undefined || revision === undefined ? 'unknown'
                : parsed.revision === revision ? 'current' : 'previous';
        scanned.push({ name, draftName, value: parsed.value,
            consentRevision: parsed.revision ?? null, provenance, raw });
    }
    // Detect changes to all bytes and membership while reading across tabs.
    const after = ownerWriterNames(owner);
    if (after.size !== names.size || [...names].some(name => !after.has(name))
        || readDeviceConsentRevision(owner) !== revision) {
        throw new Error('Copie o consenso cambiati durante la verifica. Riprova.');
    }
    for (const record of scanned) {
        if (readDeviceValueStrict(record.name, owner) !== record.raw) {
            throw new Error('Copia modificata durante la verifica. Riprova.');
        }
    }
    return scanned.map(({ raw: _raw, ...entry }) => entry)
        .sort((a, b) => a.draftName.localeCompare(b.draftName) || a.name.localeCompare(b.name));
}

export function readBufferedWriterEvidence(owner: string, draftName: string): BufferedWriterEvidence[] {
    const names = ownerWriterNames(owner);
    const revision = readDeviceConsentRevision(owner);
    const matches: BufferedWriterEvidence[] = [];
    const scanned: BufferedWriterEvidence[] = [];
    for (const name of names) {
        const raw = readDeviceValueStrict(name, owner);
        if (raw === null) throw new Error('Intenzione bozza scomparsa durante la lettura.');
        // Check provenance only for this field. A valid older-epoch witness
        // for an unrelated field must remain exportable without blocking edits here.
        // Malformed/unknown-owner records still fail closed before filtering.
        const evidence = parseWriterEvidence(name, owner, raw, false);
        scanned.push(evidence);
        const record = JSON.parse(raw) as BufferedWriterIntent;
        if (record.draftName === draftName) {
            assertWorkoutSnapshotEpoch(owner, evidence.revision);
            matches.push(evidence);
            if (matches.length > 64) throw new Error('Troppe bozze concorrenti: esportazione di recupero necessaria.');
        }
    }
    // Another tab may add a witness after the first stable inventory but
    // before its values have been authenticated. Never infer uniqueness from
    // that outdated list, including when the new witness is for this field.
    const after = ownerWriterNames(owner);
    if (after.size !== names.size || [...names].some(name => !after.has(name))
        || readDeviceConsentRevision(owner) !== revision) {
        throw new Error('Copie bufferizzate o consenso cambiati durante la lettura.');
    }
    for (const evidence of scanned) {
        if (readDeviceValueStrict(evidence.name, owner) !== evidence.raw) {
            throw new Error('Copia bufferizzata modificata durante la verifica.');
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
/** Only a genuinely absent previously written slot may be resealed under a new random key. */
export class BufferedWriterConsumedError extends Error {
    constructor() {
        super('Intenzione bozza già confermata da un altro editor; serve nuova testimonianza.');
        this.name = 'BufferedWriterConsumedError';
    }
}

export function writeBufferedWriterIntent(
    name: string, owner: string, draftName: string, value: string,
    expectedRaw: string | null, expectedConsentGeneration?: string | null,
): string {
    if (!name.startsWith(INTENT_PREFIX) || !draftName.startsWith('draft:buffered:')) {
        throw new Error('Identità intenzione bozza non valida.');
    }
    const current = readDeviceValueStrict(name, owner);
    if (current === null && expectedRaw !== null) throw new BufferedWriterConsumedError();
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
