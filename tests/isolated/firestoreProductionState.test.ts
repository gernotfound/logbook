import { describe, expect, it } from 'vitest';
import {
  classifyFieldOverride,
  FIELD_OVERRIDE_LIST_FILTER,
  fieldOverrideListParent,
  isActiveFieldIndexRemoval,
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

  it('fails closed when live state differs without a matching active removal', () => {
    expect(classifyFieldOverride(desired, [], [])).toMatchObject({
      found: false,
      pending: false,
      indexesDisabled: false,
    });
  });
});
