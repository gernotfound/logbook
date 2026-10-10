import { describe, expect, it } from 'vitest';
import {
  classifyFieldOverride,
  FIELD_OVERRIDE_LIST_FILTER,
  fieldOverrideListParent,
  isActiveFieldIndexAddition,
  isActiveFieldIndexRemoval,
  normalizeFieldIndexModes,
  parseFieldResource,
} from '../../scripts/firestore-production-state.mjs';

const desired = { collectionGroup: 'history_months', fieldPath: '*' };
const fieldName = 'projects/p/databases/(default)/collectionGroups/history_months/fields/*';

describe('Firestore Production field exemption convergence', () => {
  it('uses the database-wide explicit-override list scope used by firebase-tools', () => {
    expect(fieldOverrideListParent('p')).toBe('projects/p/databases/(default)/collectionGroups/-');
    expect(FIELD_OVERRIDE_LIST_FILTER).toBe('indexConfig.usesAncestorConfig=false OR ttlConfig:*');
    expect(() => fieldOverrideListParent('')).toThrow('Firestore project id is required');
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
      indexesDisabled: true,
      pending: false,
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
      collectionGroup: 'telemetry_errors',
      fieldPath: 'expireAt',
      indexes: [
        { queryScope: 'COLLECTION', order: 'ASCENDING' },
        { queryScope: 'COLLECTION', order: 'DESCENDING' },
        { queryScope: 'COLLECTION', arrayConfig: 'CONTAINS' },
        { queryScope: 'COLLECTION_GROUP', order: 'ASCENDING' },
      ],
    };
    const field = 'projects/p/databases/(default)/collectionGroups/telemetry_errors/fields/expireAt';
    const liveIndexes = desiredGroup.indexes.map(index => ({ ...index, state: 'READY' }));
    const ready = classifyFieldOverride(desiredGroup, [{
      name: field,
      indexConfig: { indexes: liveIndexes },
    }], []);
    expect(ready).toMatchObject({
      explicit: true, indexesMatch: true, indexesReady: true,
      matchesDesired: true, pending: false,
    });

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
