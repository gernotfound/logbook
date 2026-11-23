type RecoveryDraftWitness = {
    __logbookWorkoutRecoveryDraft: 1;
    owner: string;
    name: string;
    consentRevision: number;
    data: unknown;
};

export function decodeWorkoutRecoveryDraft(raw: string, name: string, owner: string) {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { throw new Error('Bozza workout di recupero non leggibile: originale conservato.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Bozza workout di recupero non valida: originale conservato.');
    }
    const record = parsed as Partial<RecoveryDraftWitness>;
    const hasWitness = Object.hasOwn(record, '__logbookWorkoutRecoveryDraft');
    // Owner, key and consent generation must come from the same record.
    if (owner.startsWith('user:') && !hasWitness) {
        throw new Error('Bozza workout senza provenienza verificabile: originale conservato.');
    }
    let revision: number | undefined;
    if (hasWitness) {
        if (record.__logbookWorkoutRecoveryDraft !== 1 || record.owner !== owner
            || record.name !== name || !Number.isSafeInteger(record.consentRevision)
            || (record.consentRevision ?? 0) < 1 || !Object.hasOwn(record, 'data')) {
            throw new Error('Metadati della bozza workout non validi: originale conservato.');
        }
        revision = record.consentRevision;
        parsed = record.data;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Contenuto della bozza workout non valido: originale conservato.');
    }
    return { value: parsed, revision };
}

export function encodeAccountWorkoutRecoveryDraft(name: string, owner: string, revision: number, data: unknown): string {
    return JSON.stringify({
        __logbookWorkoutRecoveryDraft: 1, owner, name, consentRevision: revision, data,
    } satisfies RecoveryDraftWitness);
}
