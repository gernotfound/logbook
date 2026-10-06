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
  // Firestore's protobuf JSON may omit output-only booleans when their value is false.
  // firebase-tools therefore matches field overrides by exact resource + index modes,
  // not by requiring an explicit `usesAncestorConfig: false` property in the response.
  const matchesDesired = Boolean(live) && explicit && !reverting && indexesDisabled;

  const activeOperation = operations.find(operation => isActiveFieldIndexRemoval(operation, desired));
  const pending = !matchesDesired && Boolean(activeOperation);
  const metadata = activeOperation?.metadata ?? {};

  return {
    ...desired,
    found: Boolean(live),
    explicit,
    reverting,
    indexesDisabled,
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
