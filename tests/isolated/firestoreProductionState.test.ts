import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  classifyFieldOverride,
  FIELD_OVERRIDE_LIST_FILTER,
  fieldOverrideListParent,
  findUnexpectedFieldOverrides,
  planRetiredFieldOverrides,
  isActiveFieldIndexAddition,
  isActiveFieldIndexRemoval,
  normalizeFieldIndexModes,
  normalizeLiveFieldIndexModes,
  parseFieldResource,
  reconcileCompositeIndexes,
  requireNoUnexpectedCompositeIndexes,
} from '../../scripts/firestore-production-state.mjs';

const desired = { collectionGroup: 'history_months', fieldPath: '*' };
const fieldName = 'projects/p/databases/(default)/collectionGroups/history_months/fields/*';

describe('Firestore Production field exemption convergence', () => {
  it('retires omitted overrides before noninteractive index deployment without using force', () => {
    const workflow = readFileSync('.github/workflows/firebase-firestore-production.yml', 'utf8');
    const retired = workflow.indexOf('node scripts/retire-firestore-field-overrides.mjs');
    const deploy = workflow.indexOf('npx --yes firebase-tools@15.30.2 deploy');
    expect(retired).toBeGreaterThan(0);
    expect(deploy).toBeGreaterThan(retired);
    expect(workflow).not.toContain('--force');
    expect(workflow).toContain('fetch-depth: 0');
  });

  it('uses the database-wide explicit-override list scope used by firebase-tools', () => {
    expect(fieldOverrideListParent('p')).toBe('projects/p/databases/(default)/collectionGroups/-');
    expect(FIELD_OVERRIDE_LIST_FILTER).toBe('indexConfig.usesAncestorConfig=false OR ttlConfig:*');
    expect(() => fieldOverrideListParent('')).toThrow('Firestore project id is required');
  });

  it('detects undesired explicit index overrides without treating TTL-only or inherited fields as overrides', () => {
    const unexpectedName = 'projects/p/databases/(default)/collectionGroups/sample_records/fields/createdAt';
    const live = [
      { name: fieldName, indexConfig: { indexes: [] } },
      { name: unexpectedName, indexConfig: { indexes: [{ queryScope: 'COLLECTION', fields: [{ fieldPath: 'createdAt', order: 'ASCENDING' }], state: 'READY' }] } },
      { name: 'projects/p/databases/(default)/collectionGroups/ttl_only/fields/expireAt', ttlConfig: { state: 'ACTIVE' } },
      { name: 'projects/p/databases/(default)/collectionGroups/inherited/fields/createdAt',
        indexConfig: { usesAncestorConfig: true, indexes: [] } },
    ];
    expect(findUnexpectedFieldOverrides([{ ...desired, indexes: [] }], live)).toEqual([
      { collectionGroup: 'sample_records', fieldPath: 'createdAt' },
    ]);
    expect(findUnexpectedFieldOverrides([{ ...desired, indexes: [] }], live.filter(field => field.name !== unexpectedName))).toEqual([]);
  });

  it('rejects a malformed explicit field resource instead of silently passing reconciliation', () => {
    expect(() => findUnexpectedFieldOverrides([], [{
      name: 'not-a-firestore-resource', indexConfig: { indexes: [] },
    }])).toThrow('Invalid explicit Firestore field resource');
  });

  it('only plans removal of a field explicitly retired by this release', () => {
    const former = { collectionGroup: 'sample_records', fieldPath: 'expireAt', indexes: [
      { queryScope: 'COLLECTION_GROUP', order: 'ASCENDING' },
    ] };
    const live = [{
      name: 'projects/p/databases/(default)/collectionGroups/sample_records/fields/expireAt',
      indexConfig: { indexes: [{ queryScope: 'COLLECTION_GROUP',
        fields: [{ fieldPath: 'expireAt', order: 'ASCENDING' }], state: 'READY' }] },
    }];
    expect(planRetiredFieldOverrides([former], [], live)).toEqual([
      { collectionGroup: 'sample_records', fieldPath: 'expireAt', reverting: false },
    ]);
    expect(planRetiredFieldOverrides([former], [], [])).toEqual([]);
    expect(planRetiredFieldOverrides([former], [former], live)).toEqual([]);
    expect(() => planRetiredFieldOverrides([], [], live)).toThrow('Undeclared Firestore field override');
    expect(() => planRetiredFieldOverrides([former], [], [{ ...live[0],
      indexConfig: { indexes: [{ queryScope: 'COLLECTION',
        fields: [{ fieldPath: 'expireAt', order: 'ASCENDING' }], state: 'READY' }] },
    }])).toThrow('Live Firestore index modes changed');
    expect(() => planRetiredFieldOverrides([former], [], [{ ...live[0],
      ttlConfig: { state: 'ACTIVE' },
    }])).toThrow('Unsafe live Firestore field override');
    expect(planRetiredFieldOverrides([former], [], [{ ...live[0],
      indexConfig: { ...live[0].indexConfig, reverting: true },
    }])).toMatchObject([{ reverting: true }]);
  });
  it('parses wildcard field resources without confusing them with literal field names', () => {
    expect(parseFieldResource(fieldName)).toEqual(desired);
    expect(parseFieldResource('invalid')).toBeNull();
  });

  it('accepts only active REMOVE operations for the exact desired field', () => {
    const removal = {
      name: 'projects/p/databases/(default)/operations/op-1',
      metadata: {
        field: fieldName,
        state: 'PROCESSING',
        indexConfigDeltas: [
          { changeType: 'REMOVE' },
          { changeType: 'REMOVE' },
        ],
      },
    };

    expect(isActiveFieldIndexRemoval(removal, desired)).toBe(true);
    expect(isActiveFieldIndexRemoval({ ...removal, done: true }, desired)).toBe(false);
    expect(isActiveFieldIndexRemoval({
      ...removal,
      metadata: { ...removal.metadata, indexConfigDeltas: [{ changeType: 'ADD' }] },
    }, desired)).toBe(false);
    expect(isActiveFieldIndexRemoval({
      ...removal,
      metadata: {
        ...removal.metadata,
        field: 'projects/p/databases/(default)/collectionGroups/nutrition_months/fields/*',
      },
    }, desired)).toBe(false);
  });

  it('classifies an exact empty explicit index config as reconciled', () => {
    expect(classifyFieldOverride(desired, [{
      name: fieldName,
      indexConfig: { usesAncestorConfig: false, reverting: false, indexes: [] },
    }], [])).toMatchObject({
      found: true,
      explicit: true,
      reverting: false,
      indexesDisabled: true,
      pending: false,
    });
  });

  it('treats an omitted false usesAncestorConfig output as an explicit exemption', () => {
    expect(classifyFieldOverride(desired, [{
      name: fieldName,
      indexConfig: { indexes: [] },
    }], [])).toMatchObject({
      found: true,
      explicit: true,
      reverting: false,
      indexesDisabled: true,
      pending: false,
    });
  });

  it('does not accept an inherited empty config as an explicit exemption', () => {
    expect(classifyFieldOverride(desired, [{
      name: fieldName,
      indexConfig: { usesAncestorConfig: true, indexes: [] },
    }], [])).toMatchObject({
      found: true,
      explicit: false,
      indexesDisabled: false,
      indexesMatch: false,
      indexesReady: false,
      matchesDesired: false,
      pending: false,
    });
  });

  it('does not certify a named field with missing or malformed index configuration', () => {
    for (const field of [
      { name: fieldName },
      { name: fieldName, indexConfig: null },
      { name: fieldName, indexConfig: { indexes: 'invalid' } },
    ]) {
      expect(classifyFieldOverride(desired, [field], [])).toMatchObject({
        found: true,
        explicit: false,
        indexesDisabled: false,
        indexesMatch: false,
        indexesReady: false,
        matchesDesired: false,
        pending: false,
      });
    }
  });

  it('accepts an explicitly configured exemption with an omitted empty indexes array', () => {
    expect(classifyFieldOverride(desired, [{
      name: fieldName, indexConfig: { usesAncestorConfig: false },
    }], [])).toMatchObject({
      explicit: true,
      indexesDisabled: true,
      indexesMatch: true,
      indexesReady: true,
      matchesDesired: true,
    });
  });

  it('classifies a verified active removal as pending instead of redeploy-required', () => {
    const status = classifyFieldOverride(desired, [{
      name: fieldName,
      indexConfig: {
        usesAncestorConfig: false,
        reverting: false,
        indexes: [{ state: 'READY' }],
      },
    }], [{
      name: 'projects/p/databases/(default)/operations/op-2',
      metadata: {
        field: fieldName,
        state: 'PROCESSING',
        indexConfigDeltas: [{ changeType: 'REMOVE' }],
        documentProgress: { completedWork: '50', estimatedWork: '100' },
      },
    }]);

    expect(status).toMatchObject({
      found: true,
      indexesDisabled: false,
      pending: true,
      operationState: 'PROCESSING',
      documentProgress: { completedWork: '50', estimatedWork: '100' },
    });
  });


  it('validates exact single-field group indexes while retaining all default collection modes', () => {
    const desiredGroup = {
      collectionGroup: 'sample_records',
      fieldPath: 'expireAt',
      indexes: [
        { queryScope: 'COLLECTION', order: 'ASCENDING' },
        { queryScope: 'COLLECTION', order: 'DESCENDING' },
        { queryScope: 'COLLECTION', arrayConfig: 'CONTAINS' },
        { queryScope: 'COLLECTION_GROUP', order: 'ASCENDING' },
      ],
    };
    const field = 'projects/p/databases/(default)/collectionGroups/sample_records/fields/expireAt';
    const liveIndexes = desiredGroup.indexes.map(index => ({
      queryScope: index.queryScope,
      fields: [{
        fieldPath: 'expireAt',
        ...(index.order ? { order: index.order } : { arrayConfig: index.arrayConfig }),
      }],
      state: 'READY',
    }));
    const ready = classifyFieldOverride(desiredGroup, [{
      name: field,
      indexConfig: { indexes: liveIndexes },
    }], []);
    expect(ready).toMatchObject({
      explicit: true, indexesMatch: true, indexesReady: true,
      matchesDesired: true, pending: false,
    });

    // Comparing desired flat configuration with the actual nested REST
    // response must succeed; that was the Production verifier's root cause.
    expect(normalizeLiveFieldIndexModes(liveIndexes, 'expireAt')).toEqual(
      normalizeFieldIndexModes(desiredGroup.indexes),
    );
    expect(() => normalizeLiveFieldIndexModes([{
      ...liveIndexes[0],
      fields: [{ fieldPath: 'wrongField', order: 'ASCENDING' }],
    }], 'expireAt')).toThrow('Unexpected Firestore live single-field index shape');
    expect(() => normalizeLiveFieldIndexModes([{
      ...liveIndexes[0],
      fields: [{ fieldPath: 'expireAt', order: 'ASCENDING' },
        { fieldPath: '__name__', order: 'ASCENDING' }],
    }], 'expireAt')).toThrow('Unexpected Firestore live single-field index shape');
    expect(() => normalizeLiveFieldIndexModes([{
      ...liveIndexes[0],
      fields: [{ fieldPath: 'expireAt', order: 'INVALID' }],
    }], 'expireAt')).toThrow('Unsupported Firestore field index mode');

    const creating = classifyFieldOverride(desiredGroup, [{
      name: field,
      indexConfig: { indexes: liveIndexes.map((index, i) =>
        i === 3 ? { ...index, state: 'CREATING' } : index) },
    }], []);
    expect(creating).toMatchObject({
      indexesMatch: true, indexesReady: false, matchesDesired: false, pending: true,
    });

    const missingMode = classifyFieldOverride(desiredGroup, [{
      name: field,
      indexConfig: { indexes: liveIndexes.slice(0, 3) },
    }], []);
    expect(missingMode).toMatchObject({ indexesMatch: false, matchesDesired: false, pending: false });

    const operation = {
      metadata: { field, state: 'PROCESSING', indexConfigDeltas: [{ changeType: 'ADD' }] },
    };
    expect(isActiveFieldIndexAddition(operation, desiredGroup)).toBe(true);
    expect(isActiveFieldIndexAddition({ ...operation, done: true }, desiredGroup)).toBe(false);
    expect(isActiveFieldIndexAddition({
      ...operation, metadata: { ...operation.metadata, indexConfigDeltas: [{ changeType: 'REMOVE' }] },
    }, desiredGroup)).toBe(false);
    expect(classifyFieldOverride(desiredGroup, [], [operation])).toMatchObject({
      found: false, matchesDesired: false, pending: true,
    });
  });

  it('rejects invalid single-field index mode declarations instead of accepting drift', () => {
    expect(() => normalizeFieldIndexModes([{ queryScope: 'INVALID', order: 'ASCENDING' }]))
      .toThrow('Unsupported Firestore field index scope');
    expect(() => normalizeFieldIndexModes([
      { queryScope: 'COLLECTION', order: 'ASCENDING' },
      { queryScope: 'COLLECTION', order: 'ASCENDING' },
    ])).toThrow('Duplicate Firestore field index mode');
    expect(() => normalizeFieldIndexModes([{ queryScope: 'COLLECTION_GROUP' }]))
      .toThrow('Unsupported Firestore field index mode');
  });

  it('fails closed when live state differs without a matching active removal', () => {
    expect(classifyFieldOverride(desired, [], [])).toMatchObject({
      found: false,
      pending: false,
      indexesDisabled: false,
    });
  });
});

describe('Firestore Production complete composite index inventory', () => {
  const wanted = [{ collectionGroup: 'account_deletions', queryScope: 'COLLECTION', fields: [
    { fieldPath: 'status', order: 'ASCENDING' }, { fieldPath: 'retryable', order: 'ASCENDING' },
  ] }];
  const ready = {
    name: 'projects/p/databases/(default)/collectionGroups/account_deletions/indexes/idx1',
    queryScope: 'COLLECTION',
    fields: [...wanted[0].fields, { fieldPath: '__name__', order: 'ASCENDING' }],
    state: 'READY',
  };

  it('detects unexpected indexes in both retained and removed groups', () => {
    const otherMode = { ...ready, name: ready.name.replace('idx1', 'idx2'),
      fields: [{ fieldPath: 'status', order: 'DESCENDING' }, { fieldPath: '__name__', order: 'DESCENDING' }] };
    const removedGroup = { ...ready,
      name: 'projects/p/databases/(default)/collectionGroups/removed_group/indexes/idx3' };
    const result = reconcileCompositeIndexes(wanted, [ready, otherMode, removedGroup], 'p');
    expect(result.statuses).toMatchObject([{ found: true, state: 'READY' }]);
    expect(result.unexpected.map(index => index.name)).toEqual([otherMode.name, removedGroup.name]);
    expect(() => requireNoUnexpectedCompositeIndexes(result.unexpected))
      .toThrow('require manual review before deployment');
    expect(() => requireNoUnexpectedCompositeIndexes([])).not.toThrow();
    expect(reconcileCompositeIndexes(wanted, [ready], 'p').unexpected).toEqual([]);
    expect(reconcileCompositeIndexes([], [ready], 'p').unexpected).toHaveLength(1);
  });

  it('does not certify an index with a non-default __name__ ordering', () => {
    const invertedName = { ...ready, fields: [
      ...wanted[0].fields, { fieldPath: '__name__', order: 'DESCENDING' },
    ] };
    const mismatch = reconcileCompositeIndexes(wanted, [invertedName], 'p');
    expect(mismatch.statuses).toMatchObject([{ found: false, state: null }]);
    expect(mismatch.unexpected.map(index => index.name)).toEqual([invertedName.name]);
    expect(() => requireNoUnexpectedCompositeIndexes(mismatch.unexpected))
      .toThrow('require manual review before deployment');

    const explicitlyDescending = [{ ...wanted[0], fields: invertedName.fields }];
    expect(reconcileCompositeIndexes(explicitlyDescending, [invertedName], 'p'))
      .toMatchObject({ statuses: [{ found: true, state: 'READY' }], unexpected: [] });
  });

  it('rejects absent or malformed live __name__ suffixes instead of matching partially', () => {
    expect(() => reconcileCompositeIndexes(wanted, [{ ...ready, fields: wanted[0].fields }], 'p'))
      .toThrow('Missing Firestore live composite index __name__ field');
    expect(() => reconcileCompositeIndexes(wanted, [{ ...ready, fields: [
      { fieldPath: '__name__', order: 'ASCENDING' }, ...wanted[0].fields,
    ] }], 'p')).toThrow('Invalid Firestore composite index __name__ position');
    expect(() => reconcileCompositeIndexes(wanted, [{ ...ready, fields: [
      ...wanted[0].fields, { fieldPath: '__name__', order: 'INVALID' },
    ] }], 'p')).toThrow('Unsupported Firestore composite index order');
    expect(() => reconcileCompositeIndexes(wanted, [{ ...ready, fields: [
      { fieldPath: 'status', order: 'ASCENDING', arrayConfig: 'CONTAINS' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ] }], 'p')).toThrow('Unsupported Firestore composite index field');
  });

  it('applies Firestore implicit __name__ defaults to array and vector indexes', () => {
    const expectedArray = [{ collectionGroup: 'sample', queryScope: 'COLLECTION', fields: [
      { fieldPath: 'status', order: 'DESCENDING' },
      { fieldPath: 'tags', arrayConfig: 'CONTAINS' },
    ] }];
    const arrayIndex = { name: 'projects/p/databases/(default)/collectionGroups/sample/indexes/a',
      queryScope: 'COLLECTION', fields: [
        ...expectedArray[0].fields, { fieldPath: '__name__', order: 'DESCENDING' },
      ], state: 'READY' };
    expect(reconcileCompositeIndexes(expectedArray, [arrayIndex], 'p'))
      .toMatchObject({ statuses: [{ found: true, state: 'READY' }], unexpected: [] });

    const expectedVector = [{ collectionGroup: 'sample', queryScope: 'COLLECTION', fields: [
      { fieldPath: 'category', order: 'ASCENDING' },
      { fieldPath: 'embedding', vectorConfig: { dimension: 4, flat: {} } },
    ] }];
    const vectorIndex = { ...arrayIndex, fields: [
      expectedVector[0].fields[0], { fieldPath: '__name__', order: 'ASCENDING' },
      expectedVector[0].fields[1],
    ] };
    expect(reconcileCompositeIndexes(expectedVector, [vectorIndex], 'p'))
      .toMatchObject({ statuses: [{ found: true, state: 'READY' }], unexpected: [] });
  });

  it('distinguishes missing, building and malformed indexes', () => {
    expect(reconcileCompositeIndexes(wanted, [], 'p').statuses)
      .toMatchObject([{ found: false, state: null }]);
    expect(reconcileCompositeIndexes(wanted, [{ ...ready, state: 'CREATING' }], 'p').statuses)
      .toMatchObject([{ found: true, state: 'CREATING' }]);
    expect(() => reconcileCompositeIndexes(wanted, [{ ...ready,
      name: 'projects/other/databases/(default)/collectionGroups/account_deletions/indexes/idx1' }], 'p'))
      .toThrow('Invalid live Firestore composite index resource');
    expect(() => reconcileCompositeIndexes(wanted, [ready, ready], 'p'))
      .toThrow('Duplicate live Firestore composite index');
  });

  it('requires database-wide composite index inventory readback', () => {
    const verifier = readFileSync('scripts/verify-firestore-production.mjs', 'utf8');
    expect(verifier).toContain('collectionGroups/-');
    expect(verifier).toContain('requireNoUnexpectedCompositeIndexes(unexpectedIndexes)');
  });
});
