import { deviceKey, readDeviceValueStrict, writeDeviceValue } from './deviceStorage';
import { assertWorkoutSnapshotEpoch, readDeviceConsentRevision } from './workoutDeviceIntent';
import { stableStorageKeyInventory } from './stableStorageKeyInventory';

const PREFIX = 'draft:dated-intent:';
const ID = /^[a-f0-9]{32}$/;
const DATED_KEY = /^draft:[a-z0-9-]{1,100}:\d{4}-\d{2}-\d{2}$/;
const MAX_WRITERS_PER_FIELD = 64;
const MAX_INSPECTED_WRITERS = 1024;
const MAX_VALUES_LENGTH = 100_000;

type DatedIntent = {
    __logbookDatedWriterIntent: 1;
    owner: string;
    draftName: string;
    values: Record<string, string>;
    consentRevision?: number;
};

export type DatedWriterEvidence = {
    name: string;
    raw: string;
    values: Record<string, string>;
    consentRevision?: number;
};
export type DatedRecoveryEntry = {
    name: string;
    draftName: string;
    value: string;
    consentRevision: number | null;
    provenance: 'current' | 'previous' | 'unknown' | 'guest';
};

export function createDatedWriterIntentName(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return PREFIX + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function validValues(values: unknown): values is Record<string, string> {
    return values !== null && typeof values === 'object' && !Array.isArray(values)
        && Object.entries(values).every(([field, value]) => field.length <= 128 && typeof value === 'string')
        && JSON.stringify(values).length <= MAX_VALUES_LENGTH;
}

function parse(name: string, owner: string, raw: string): DatedWriterEvidence & { draftName: string } {
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new Error('Copia datata non valida: originale conservato.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Copia datata senza provenienza: originale conservato.');
    }
    const d = value as Partial<DatedIntent>;
    if (!name.startsWith(PREFIX) || !ID.test(name.slice(PREFIX.length))
        || d.__logbookDatedWriterIntent !== 1 || d.owner !== owner
        || typeof d.draftName !== 'string' || !DATED_KEY.test(d.draftName)
        || !validValues(d.values)
        || (d.consentRevision !== undefined && (!Number.isSafeInteger(d.consentRevision)
            || d.consentRevision < 1))) {
        throw new Error('Metadati copia datata non validi: originale conservato.');
    }
    return { name, raw, draftName: d.draftName, values: d.values, consentRevision: d.consentRevision };
}

function ownerNames(owner: string): Set<string> {
    const prefix = deviceKey('', owner);
    const names = new Set<string>();
    const inventory = stableStorageKeyInventory('Elenco copie datate modificato durante la lettura.');
    for (const key of inventory) {
        if (!key.startsWith(prefix)) continue;
        const suffix = key.slice(prefix.length);
        const name = suffix.startsWith('sealed:') ? suffix.slice(7) : suffix;
        if (name.startsWith(PREFIX)) names.add(name);
    }
    if (names.size > MAX_INSPECTED_WRITERS) {
        throw new Error('Troppe copie datate: conserva il Backup JSON e richiedi recupero.');
    }
    return names;
}

/** Never select one of two contenders. Authenticate every scanned record, including foreign-key tampering. */
export function readDatedWriterEvidence(owner: string, draftName: string): DatedWriterEvidence[] {
    if (!DATED_KEY.test(draftName)) throw new Error('Identità bozza datata non valida.');
    const names = ownerNames(owner);
    const revision = readDeviceConsentRevision(owner);
    const matches: DatedWriterEvidence[] = [];
    const scanned: DatedWriterEvidence[] = [];
    for (const name of names) {
        const raw = readDeviceValueStrict(name, owner);
        if (raw === null) throw new Error('Copia datata scomparsa durante la lettura.');
        const candidate = parse(name, owner, raw);
        scanned.push(candidate);
        if (candidate.draftName !== draftName) continue;
        assertWorkoutSnapshotEpoch(owner, candidate.consentRevision);
        matches.push(candidate);
        if (matches.length > MAX_WRITERS_PER_FIELD) {
            throw new Error('Troppe copie concorrenti: recupero esplicito necessario.');
        }
    }
    // Authenticate the entire owner-scoped inventory, not just today's
    // matching field: another tab can change an existing witness while its key
    // membership remains stable. The consent epoch must also remain unchanged.
    const after = ownerNames(owner);
    if (after.size !== names.size || [...names].some(name => !after.has(name))
        || readDeviceConsentRevision(owner) !== revision) {
        throw new Error('Copie datate o consenso cambiati durante la lettura.');
    }
    for (const witness of scanned) {
        if (readDeviceValueStrict(witness.name, owner) !== witness.raw) {
            throw new Error('Copia datata modificata durante la verifica.');
        }
    }
    return matches;
}

function assertRevision(owner: string, expected?: string | null): number | undefined {
    const revision = readDeviceConsentRevision(owner);
    if (owner.startsWith('user:') && expected !== undefined
        && expected !== (revision === undefined ? null : String(revision))) {
        throw new Error('Consenso modificato: copia datata conservata.');
    }
    return revision;
}

/** Independently and synchronously persist the editor's full latest value before its shared draft write. */
/** Only a genuinely absent previously written slot may be resealed under a new random key. */
export class DatedWriterConsumedError extends Error {
    constructor() {
        super('Copia datata già confermata da un altro editor; serve nuova testimonianza.');
        this.name = 'DatedWriterConsumedError';
    }
}

export function writeDatedWriterIntent(
    name: string, owner: string, draftName: string, values: Record<string, string>,
    expectedRaw: string | null, expectedConsentGeneration?: string | null,
): string {
    if (!name.startsWith(PREFIX) || !ID.test(name.slice(PREFIX.length)) || !DATED_KEY.test(draftName)
        || !validValues(values)) throw new Error('Identità o contenuto della copia datata non validi.');
    const current = readDeviceValueStrict(name, owner);
    if (current === null && expectedRaw !== null) throw new DatedWriterConsumedError();
    if (current !== expectedRaw) throw new Error('Copia datata modificata: originale conservato.');
    if (current !== null) {
        const previous = parse(name, owner, current);
        assertWorkoutSnapshotEpoch(owner, previous.consentRevision);
        if (previous.draftName !== draftName) throw new Error('Copia datata associata a un altro campo.');
    }
    const revision = assertRevision(owner, expectedConsentGeneration);
    const raw = JSON.stringify({
        __logbookDatedWriterIntent: 1, owner, draftName, values,
        ...(owner.startsWith('user:') && revision !== undefined ? { consentRevision: revision } : {}),
    } satisfies DatedIntent);
    writeDeviceValue(name, raw, owner);
    return raw;
}

export function clearDatedWriterIntent(
    name: string, owner: string, expectedRaw: string,
    expectedConsentGeneration?: string | null,
): void {
    if (!name.startsWith(PREFIX) || !ID.test(name.slice(PREFIX.length))) {
        throw new Error('Identità copia datata non valida.');
    }
    const current = readDeviceValueStrict(name, owner);
    if (current !== expectedRaw) throw new Error('Copia datata differente: originale conservato.');
    const previous = parse(name, owner, current);
    assertWorkoutSnapshotEpoch(owner, previous.consentRevision);
    assertRevision(owner, expectedConsentGeneration);
    writeDeviceValue(name, null, owner);
}

/** Explicit, read-only inspection; the recovery view never publishes a witness to business state. */
export function inspectDatedRecoveryEvidence(owner: string): DatedRecoveryEntry[] {
    const names = ownerNames(owner);
    const revision = readDeviceConsentRevision(owner);
    const scanned: (DatedRecoveryEntry & { raw: string })[] = [];
    let total = 0;
    for (const name of names) {
        const raw = readDeviceValueStrict(name, owner);
        if (raw === null) throw new Error('Copia datata scomparsa durante la verifica.');
        const parsed = parse(name, owner, raw);
        const value = JSON.stringify(parsed.values, null, 2);
        total += value.length;
        if (total > 1_000_000) throw new Error('Anteprima copie datate troppo grande: conserva Backup JSON.');
        const provenance: DatedRecoveryEntry['provenance'] =
            owner === 'guest' ? 'guest'
            : revision === undefined || parsed.consentRevision === undefined ? 'unknown'
                : revision === parsed.consentRevision ? 'current' : 'previous';
        scanned.push({ name, raw, draftName: parsed.draftName, value,
            consentRevision: parsed.consentRevision ?? null, provenance });
    }
    const after = ownerNames(owner);
    if (after.size !== names.size || [...names].some(name => !after.has(name))
        || readDeviceConsentRevision(owner) !== revision) {
        throw new Error('Copie o consenso cambiati durante la verifica.');
    }
    for (const x of scanned) {
        if (readDeviceValueStrict(x.name, owner) !== x.raw) {
            throw new Error('Copia datata cambiata durante la verifica.');
        }
    }
    return scanned.map(({ raw: _raw, ...entry }) => entry)
        .sort((a, b) => a.draftName.localeCompare(b.draftName) || a.name.localeCompare(b.name));
}
