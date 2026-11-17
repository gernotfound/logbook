/**
 * A recovered editor writes to a new device key, never to its predecessor's:
 * that predecessor may still be mounted in another tab. Automatic recovery
 * is allowed only for a fully authenticated, unbranched chain of revisions.
 */
export type WriterLineageReference = {
    name: string;
    revisionId?: string;
    raw?: string;
};

export type WriterLineageEntry = {
    name: string;
    raw: string;
    revisionId?: string;
    parent?: WriterLineageReference;
};

export function newWriterRevisionId(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export function writerParentReference(
    source: WriterLineageEntry | null | undefined,
): WriterLineageReference | undefined {
    if (!source) return undefined;
    return source.revisionId
        ? { name: source.name, revisionId: source.revisionId }
        : { name: source.name, raw: source.raw };
}

/**
 * Distinct roots, sibling successors, missing/stale parents and cycles are
 * ambiguous. Never select the last shared draft as a substitute for evidence.
 */
export function traceWriterLineage<T extends WriterLineageEntry>(entries: readonly T[]): T[] {
    if (!entries.length) return [];
    const byName = new Map(entries.map(entry => [entry.name, entry]));
    if (byName.size !== entries.length) throw new Error('Testimonianze duplicate: recupero sospeso.');
    const next = new Map<string, T>();
    const roots: T[] = [];
    for (const entry of entries) {
        if (!entry.parent) { roots.push(entry); continue; }
        const ancestor = byName.get(entry.parent.name);
        if (!ancestor || (entry.parent.revisionId
            ? ancestor.revisionId !== entry.parent.revisionId
            : ancestor.raw !== entry.parent.raw)
            || next.has(entry.parent.name)) {
            throw new Error('Testimonianze concorrenti o catena di recupero alterata.');
        }
        next.set(entry.parent.name, entry);
    }
    if (roots.length !== 1) throw new Error('Testimonianze concorrenti o catena di recupero ciclica.');
    const chain: T[] = [];
    const visited = new Set<string>();
    for (let entry: T | undefined = roots[0]; entry; entry = next.get(entry.name)) {
        if (visited.has(entry.name)) throw new Error('Catena testimonianze ciclica.');
        visited.add(entry.name);
        chain.push(entry);
    }
    if (chain.length !== entries.length) throw new Error('Testimonianze concorrenti o catena incompleta.');
    return chain;
}
