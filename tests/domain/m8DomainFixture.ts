import { UserDataSchema } from '../../src/lib/schema';
import type { CachedGlobalCatalog, UserData } from '../../src/types';
import { applyDomainOperations, compileDomainOperations, type DomainOperation } from '../../src/lib/sync/domainOperations';
import { applySemanticOperations } from '../../src/lib/sync/semanticProjection';
import { projectDocuments } from '../../src/lib/sync/documentProjection';

export const catalog: CachedGlobalCatalog = {
    manifest: {
        version: 'm8-test',
        updatedAt: '2026-09-15T00:00:00.000Z',
        schemaVersion: 1,
        docRefs: { exercises: 'catalog/exercises', foods: 'catalog/foods' },
        itemCounts: { exercises: 0, foods: 0 },
    },
    exercises: [],
    foods: [],
    cachedAt: 0,
};

export const base = (overrides: Partial<UserData> = {}): UserData =>
    UserDataSchema.parse(overrides) as unknown as UserData;

// Exercise the production reducer, compiler and semantic replayer together.
// Neither compiled operations nor the replayed documents are mocked here.
export const compile = (before: UserData, operation: DomainOperation | DomainOperation[]) => {
    const after = applyDomainOperations(before, operation);
    const operations = compileDomainOperations(before, after, operation, catalog, 'actor-a', 1, { 'actor-a': 1 });
    const replay = applySemanticOperations(projectDocuments(before, catalog), operations).documents;
    return { after, operations, replay };
};
