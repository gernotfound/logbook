export const FIELD_OVERRIDE_LIST_FILTER = 'indexConfig.usesAncestorConfig=false OR ttlConfig:*';

export function fieldOverrideListParent(projectId) {
  if (!projectId) throw new Error('Firestore project id is required');
  return `projects/${projectId}/databases/(default)/collectionGroups/-`;
}

function decodeResourceSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseFieldResource(resourceName) {
  const value = String(resourceName ?? '');
  const collectionMarker = '/collectionGroups/';
  const fieldMarker = '/fields/';
  const collectionStart = value.indexOf(collectionMarker);
  if (collectionStart < 0) return null;
  const fieldStart = value.indexOf(fieldMarker, collectionStart + collectionMarker.length);
  if (fieldStart < 0) return null;

  const collectionGroup = value.slice(collectionStart + collectionMarker.length, fieldStart);
  const fieldPath = value.slice(fieldStart + fieldMarker.length);
  if (!collectionGroup || !fieldPath) return null;

  return {
    collectionGroup: decodeResourceSegment(collectionGroup),
    fieldPath: decodeResourceSegment(fieldPath),
  };
}

// Field overrides omitted from firestore.indexes.json must not remain silently
// active: a successful reconciliation has to verify removals as well as additions.
// TTL-only fields and inherited index configurations are not explicit overrides.
export function findUnexpectedFieldOverrides(desired, liveFields) {
  const known = new Set(desired.map(field => `${field.collectionGroup}/${field.fieldPath}`));
  const unexpected = [];
  for (const field of liveFields) {
    const config = field?.indexConfig;
    if (!config || config.usesAncestorConfig === true) continue;
    if (config.indexes !== undefined && !Array.isArray(config.indexes)) {
      throw new Error('Invalid explicit Firestore field indexes');
    }
    const resource = parseFieldResource(field.name);
    if (!resource) throw new Error('Invalid explicit Firestore field resource');
    if (resource.collectionGroup === '__default__') continue;
    if (!known.has(`${resource.collectionGroup}/${resource.fieldPath}`)) unexpected.push(resource);
  }
  return unexpected;
}

// Only field overrides deleted from the immediately preceding version may be
// retired automatically. A mismatched live override could have been changed by
// another administrator; it must not be overwritten by this release.
export function planRetiredFieldOverrides(previous, desired, liveFields) {
  const keyOf = field => `${field.collectionGroup}/${field.fieldPath}`;
  const desiredKeys = new Set(desired.map(keyOf));
  const retired = previous.filter(field => !desiredKeys.has(keyOf(field)));
  const retiredByKey = new Map(retired.map(field => [keyOf(field), field]));
  if (retiredByKey.size !== retired.length) throw new Error('Duplicate retired Firestore override');
  const unexpected = findUnexpectedFieldOverrides(desired, liveFields);
  const operations = [];
  for (const field of unexpected) {
    const previousField = retiredByKey.get(keyOf(field));
    if (!previousField) throw new Error(`Undeclared Firestore field override: ${keyOf(field)}`);
    if (!/^[A-Za-z0-9_]+$/.test(field.collectionGroup) ||
        !/^[A-Za-z0-9_]+$/.test(field.fieldPath)) {
      throw new Error('Unsupported retired Firestore field path');
    }
    const live = liveFields.find(item => {
      const parsed = parseFieldResource(item?.name);
      return parsed?.collectionGroup === field.collectionGroup && parsed.fieldPath === field.fieldPath;
    });
    if (!live || !live.indexConfig || live.ttlConfig) {
      throw new Error(`Unsafe live Firestore field override: ${keyOf(field)}`);
    }
    if (live.indexConfig.reverting !== true) {
      const oldModes = normalizeFieldIndexModes(previousField.indexes);
      const liveModes = normalizeLiveFieldIndexModes(live.indexConfig.indexes ?? [], field.fieldPath);
      if (JSON.stringify(oldModes) !== JSON.stringify(liveModes)) {
        throw new Error(`Live Firestore index modes changed: ${keyOf(field)}`);
      }
    }
    operations.push({ collectionGroup: field.collectionGroup, fieldPath: field.fieldPath,
      reverting: live.indexConfig.reverting === true });
  }
  return operations;
}
export function normalizeFieldIndexModes(indexes) {
  if (!Array.isArray(indexes)) throw new Error('Field override indexes must be an array');
  const modes = indexes.map(index => {
    if (!index || !['COLLECTION', 'COLLECTION_GROUP'].includes(index.queryScope)) {
      throw new Error('Unsupported Firestore field index scope');
    }
    const hasOrder = ['ASCENDING', 'DESCENDING'].includes(index.order);
    const hasArray = index.arrayConfig === 'CONTAINS';
    if (hasOrder === hasArray || (index.order && !hasOrder) || (index.arrayConfig && !hasArray)) {
      throw new Error('Unsupported Firestore field index mode');
    }
    return `${index.queryScope}:${hasOrder ? index.order : 'CONTAINS'}`;
  }).sort();
  if (new Set(modes).size !== modes.length) {
    throw new Error('Duplicate Firestore field index mode');
  }
  return modes;
}

// Firestore's Admin REST Field.indexConfig.indexes[] uses full Index objects:
// { queryScope, fields: [{ fieldPath, order|arrayConfig }], state }.
// firestore.indexes.json fieldOverrides, by contrast, use flat mode descriptors.
export function normalizeLiveFieldIndexModes(indexes, expectedFieldPath) {
  if (!Array.isArray(indexes) || !expectedFieldPath) {
    throw new Error('Invalid live Firestore field index configuration');
  }
  return normalizeFieldIndexModes(indexes.map(index => {
    if (!index || !Array.isArray(index.fields) || index.fields.length !== 1 ||
        index.fields[0]?.fieldPath !== expectedFieldPath) {
      throw new Error('Unexpected Firestore live single-field index shape');
    }
    const field = index.fields[0];
    return { queryScope: index.queryScope, order: field.order, arrayConfig: field.arrayConfig };
  }));
}


function normalizeCompositeIndexFields(fields, live) {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error('Invalid Firestore composite index fields');
  }
  const normalized = fields.map(field => {
    if (typeof field?.fieldPath !== 'string' || !field.fieldPath) {
      throw new Error('Invalid Firestore composite index field path');
    }
    const modes = ['order', 'arrayConfig', 'vectorConfig'].filter(mode => field[mode] !== undefined);
    if (modes.length !== 1) throw new Error('Unsupported Firestore composite index field');
    if (field.order !== undefined && !['ASCENDING', 'DESCENDING'].includes(field.order)) {
      throw new Error('Unsupported Firestore composite index order');
    }
    if (field.arrayConfig !== undefined && field.arrayConfig !== 'CONTAINS') {
      throw new Error('Unsupported Firestore composite index array mode');
    }
    if (field.vectorConfig !== undefined && (!field.vectorConfig ||
      typeof field.vectorConfig !== 'object' || Array.isArray(field.vectorConfig))) {
      throw new Error('Unsupported Firestore composite index vector mode');
    }
    return { fieldPath: field.fieldPath, [modes[0]]: field[modes[0]] };
  });

  // Firestore adds __name__ implicitly with the direction of the last ordered
  // field (ASCENDING if none). An explicit non-default direction is a different
  // index, and must never be discarded during Production reconciliation.
  const vectorLast = normalized.at(-1).vectorConfig !== undefined;
  const namePosition = vectorLast ? normalized.length - 2 : normalized.length - 1;
  const nameFields = normalized.filter(field => field.fieldPath === '__name__');
  if (nameFields.length > 0) {
    if (nameFields.length !== 1 || normalized[namePosition]?.fieldPath !== '__name__' ||
        !normalized[namePosition].order) {
      throw new Error('Invalid Firestore composite index __name__ position');
    }
    return normalized;
  }
  if (live) throw new Error('Missing Firestore live composite index __name__ field');

  const defaultNameOrder = normalized.reduce(
    (direction, field) => field.order ?? direction, 'ASCENDING',
  );
  normalized.splice(vectorLast ? normalized.length - 1 : normalized.length, 0,
    { fieldPath: '__name__', order: defaultNameOrder });
  return normalized;
}

// An index removed from the manifest may belong to a collection group that has
// no remaining desired indexes. Read the complete inventory before certification.
export function reconcileCompositeIndexes(desiredIndexes, liveIndexes, projectId) {
  if (!projectId || !Array.isArray(desiredIndexes) || !Array.isArray(liveIndexes)) {
    throw new Error('Invalid Firestore composite index inventory');
  }
  const desired = desiredIndexes.map(index => {
    if (!index?.collectionGroup || !index.queryScope || !Array.isArray(index.fields)) {
      throw new Error('Invalid desired Firestore composite index');
    }
    return { collectionGroup: index.collectionGroup, queryScope: index.queryScope,
      fields: normalizeCompositeIndexFields(index.fields, false) };
  });
  const prefix = `projects/${projectId}/databases/(default)/collectionGroups/`;
  const live = liveIndexes.map(index => {
    if (typeof index?.name !== 'string' || !index.name.startsWith(prefix)) {
      throw new Error('Invalid live Firestore composite index resource');
    }
    const match = /^([^/]+)\/indexes\/([^/]+)$/.exec(index.name.slice(prefix.length));
    if (!match) throw new Error('Invalid live Firestore composite index resource');
    return { collectionGroup: decodeResourceSegment(match[1]), queryScope: index.queryScope,
      fields: normalizeCompositeIndexFields(index.fields, true),
      name: index.name, state: index.state ?? null };
  });
  const key = index => JSON.stringify([index.collectionGroup, index.queryScope, index.fields]);
  const desiredKeys = new Set(desired.map(key));
  if (desiredKeys.size !== desired.length) throw new Error('Duplicate desired Firestore composite index');
  if (new Set(live.map(key)).size !== live.length) throw new Error('Duplicate live Firestore composite index');
  return {
    statuses: desired.map(index => {
      const match = live.find(candidate => key(candidate) === key(index));
      return { ...index, found: Boolean(match), state: match?.state ?? null };
    }),
    unexpected: live.filter(index => !desiredKeys.has(key(index))),
  };
}


export function requireNoUnexpectedCompositeIndexes(indexes) {
  if (!Array.isArray(indexes)) throw new Error('Invalid Firestore composite index reconciliation result');
  if (indexes.length > 0) {
    throw new Error('Unexpected Firestore composite indexes require manual review before deployment: ' +
      indexes.map(index => index.name).join(', '));
  }
}

export function isActiveFieldIndexAddition(operation, desired) {
  if (!operation || operation.done === true || operation.error) return false;
  const field = parseFieldResource(operation.metadata?.field);
  if (!field || field.collectionGroup !== desired.collectionGroup || field.fieldPath !== desired.fieldPath) {
    return false;
  }
  const deltas = Array.isArray(operation.metadata?.indexConfigDeltas)
    ? operation.metadata.indexConfigDeltas
    : [];
  return deltas.length > 0 && deltas.every(delta => delta?.changeType === 'ADD');
}

export function isActiveFieldIndexRemoval(operation, desired) {
  if (!operation || operation.done === true || operation.error) return false;
  const metadata = operation.metadata;
  const field = parseFieldResource(metadata?.field);
  if (!field || field.collectionGroup !== desired.collectionGroup || field.fieldPath !== desired.fieldPath) {
    return false;
  }

  const deltas = Array.isArray(metadata?.indexConfigDeltas) ? metadata.indexConfigDeltas : [];
  return deltas.length > 0 && deltas.every(delta => delta?.changeType === 'REMOVE');
}

export function classifyFieldOverride(desired, liveFields, operations) {
  const live = liveFields.find(field => {
    const parsed = parseFieldResource(field?.name);
    return parsed?.collectionGroup === desired.collectionGroup && parsed.fieldPath === desired.fieldPath;
  });
  const indexConfig = live?.indexConfig;
  const indexes = Array.isArray(indexConfig?.indexes) ? indexConfig.indexes : [];
  // A Field name alone does not prove an explicit exemption: the API can return
  // a field without indexConfig, which must not certify Production as reconciled.
  const explicit = Boolean(indexConfig) && typeof indexConfig === 'object'
    && !Array.isArray(indexConfig) && indexConfig.usesAncestorConfig !== true
    && (indexConfig.indexes === undefined || Array.isArray(indexConfig.indexes));
  const reverting = indexConfig?.reverting === true;
  const indexesDisabled = explicit && indexes.length === 0;
  const desiredModes = normalizeFieldIndexModes(desired.indexes ?? []);
  const indexesMatch = explicit && (desiredModes.length === 0
    ? indexes.length === 0
    : JSON.stringify(normalizeLiveFieldIndexModes(indexes, desired.fieldPath)) === JSON.stringify(desiredModes));
  const indexesReady = indexesMatch &&
    indexes.every(index => index.state === 'READY');
  // Firestore protobuf JSON may omit output-only false values. An explicit
  // override must be matched by resource and complete index modes, not by
  // an encoded usesAncestorConfig:false property.
  const matchesDesired = Boolean(live) && explicit && !reverting &&
    indexesMatch && indexesReady;

  const activeOperation = operations.find(operation =>
    desiredModes.length === 0
      ? isActiveFieldIndexRemoval(operation, desired)
      : isActiveFieldIndexAddition(operation, desired)
  );
  const building = indexesMatch && indexes.some(index => index.state === 'CREATING');
  const pending = !matchesDesired && (Boolean(activeOperation) || (explicit && !reverting && building));
  const metadata = activeOperation?.metadata ?? {};

  return {
    ...desired,
    found: Boolean(live),
    explicit,
    reverting,
    indexesDisabled,
    indexesMatch,
    indexesReady,
    matchesDesired,
    pending,
    operationName: activeOperation?.name ?? null,
    operationState: metadata.state ?? null,
    documentProgress: metadata.documentProgress ?? null,
    bytesProgress: metadata.bytesProgress ?? null,
  };
}

export function progressSummary(status) {
  const operation = status.operationName ? ` operation=${status.operationName.split('/').at(-1)}` : '';
  const state = status.operationState ? ` state=${status.operationState}` : '';
  const documentProgress = status.documentProgress
    ? ` docs=${status.documentProgress.completedWork ?? '?'}/${status.documentProgress.estimatedWork ?? '?'}`
    : '';
  return `${operation}${state}${documentProgress}`;
}
