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
  const explicit = Boolean(live) && indexConfig?.usesAncestorConfig !== true;
  const reverting = indexConfig?.reverting === true;
  const indexesDisabled = Boolean(live) && indexes.length === 0;
  const desiredModes = normalizeFieldIndexModes(desired.indexes ?? []);
  const indexesMatch = Boolean(live) && (desiredModes.length === 0
    ? indexes.length === 0
    : JSON.stringify(normalizeFieldIndexModes(indexes)) === JSON.stringify(desiredModes));
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
