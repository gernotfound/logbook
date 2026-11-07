import { readFileSync } from 'node:fs';
import {
  classifyFieldOverride,
  findUnexpectedFieldOverrides,
  FIELD_OVERRIDE_LIST_FILTER,
  fieldOverrideListParent,
  normalizeFieldIndexModes,
  reconcileCompositeIndexes,
  requireNoUnexpectedCompositeIndexes,
  progressSummary,
} from './firestore-production-state.mjs';

const mode = process.argv[2] ?? 'verify';
const projectId = process.env.FIREBASE_PROJECT_ID;
const accessToken = process.env.GCP_ACCESS_TOKEN;

if (!projectId) throw new Error('FIREBASE_PROJECT_ID is required');
if (!accessToken) throw new Error('GCP_ACCESS_TOKEN is required');
if (!['preflight', 'status', 'verify'].includes(mode)) throw new Error(`Unsupported mode: ${mode}`);

const rulesSource = readFileSync('firestore.rules', 'utf8');
const indexConfig = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'));

if (!Array.isArray(indexConfig.indexes)) throw new Error('firestore.indexes.json must contain an indexes array');
if (!Array.isArray(indexConfig.fieldOverrides)) throw new Error('firestore.indexes.json must contain a fieldOverrides array');

const normalizeText = value => String(value ?? '').replace(/\r\n/g, '\n').trimEnd();

const requestJson = async url => {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GET ${url} failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  return text ? JSON.parse(text) : {};
};

const loadLiveIndexes = async () => {
  const indexes = [];
  let pageToken = '';
  do {
    // Firebase CLI uses this database-wide wildcard, including groups removed
    // from the manifest; per-group reads cannot detect their stale indexes.
    const parent = `projects/${projectId}/databases/(default)/collectionGroups/-`;
    const url = new URL(`https://firestore.googleapis.com/v1/${parent}/indexes`);
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const payload = await requestJson(url.toString());
    if (payload.indexes !== undefined && !Array.isArray(payload.indexes)) {
      throw new Error('Invalid Firestore composite index list response');
    }
    indexes.push(...(payload.indexes ?? []));
    pageToken = payload.nextPageToken ?? '';
  } while (pageToken);
  return indexes;
};

const normalizeDesiredFieldOverride = override => {
  if (!override?.collectionGroup || !override?.fieldPath || !Array.isArray(override.indexes)) {
    throw new Error(`Invalid desired field override: ${JSON.stringify(override)}`);
  }
  // Validate every desired single-field mode before deciding whether a deploy
  // or a live READY-state verification is necessary.
  normalizeFieldIndexModes(override.indexes);
  return {
    collectionGroup: override.collectionGroup,
    fieldPath: override.fieldPath,
    indexes: override.indexes,
  };
};

const loadLiveFieldOverrides = async () => {
  const fields = [];
  let pageToken = '';

  do {
    // Match firebase-tools' own readback boundary: collectionGroups/- lists explicit
    // field overrides across the database. Per-collection ListFields can omit the
    // special "*" collection-level exemption even though the override exists.
    const parent = fieldOverrideListParent(projectId);
    const url = new URL(`https://firestore.googleapis.com/v1/${parent}/fields`);
    url.searchParams.set('filter', FIELD_OVERRIDE_LIST_FILTER);
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const payload = await requestJson(url.toString());
    fields.push(...(payload.fields ?? []));
    pageToken = payload.nextPageToken ?? '';
  } while (pageToken);

  return fields.filter(field => !String(field?.name ?? '').includes('/collectionGroups/__default__/'));
};

const loadActiveFirestoreOperations = async () => {
  const operations = [];
  let pageToken = '';

  do {
    const parent = `projects/${projectId}/databases/(default)`;
    const url = new URL(`https://firestore.googleapis.com/v1/${parent}/operations`);
    url.searchParams.set('filter', 'done:false');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const payload = await requestJson(url.toString());
    operations.push(...(payload.operations ?? []));
    pageToken = payload.nextPageToken ?? '';
  } while (pageToken);

  return operations;
};

const desiredFieldOverrides = indexConfig.fieldOverrides.map(normalizeDesiredFieldOverride);

const release = await requestJson(
  `https://firebaserules.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/releases/cloud.firestore`,
);
if (!release.rulesetName) throw new Error('Live Cloud Firestore release has no rulesetName');

const ruleset = await requestJson(
  `https://firebaserules.googleapis.com/v1/${release.rulesetName}`,
);
const liveRulesFile = (ruleset.source?.files ?? []).find(file => file.name === 'firestore.rules')
  ?? (ruleset.source?.files ?? [])[0];
if (!liveRulesFile?.content) throw new Error('Live Cloud Firestore ruleset source is unavailable');

const { statuses: indexStatuses, unexpected: unexpectedIndexes } = reconcileCompositeIndexes(
  indexConfig.indexes, await loadLiveIndexes(), projectId,
);

const activeOperations = desiredFieldOverrides.length > 0
  ? await loadActiveFirestoreOperations()
  : [];
const liveFieldOverrides = await loadLiveFieldOverrides();
const fieldOverrideStatuses = desiredFieldOverrides.map(desired =>
  classifyFieldOverride(desired, liveFieldOverrides, activeOperations)
);
const unexpectedFieldOverrides = findUnexpectedFieldOverrides(desiredFieldOverrides, liveFieldOverrides);

const rulesMatch = normalizeText(liveRulesFile.content) === normalizeText(rulesSource);
const missingIndexes = indexStatuses.filter(status => !status.found);
const pendingIndexes = indexStatuses.filter(status => status.found && status.state !== 'READY');
const pendingFieldOverrides = fieldOverrideStatuses.filter(status => status.pending);
const mismatchedFieldOverrides = fieldOverrideStatuses.filter(status =>
  !status.pending && !status.matchesDesired
);

if (mode === 'preflight') {
  console.log(`Firestore deploy preflight OK for project ${projectId}: authenticated Rules/Index read access confirmed.`);
  console.log(`- rules: ${rulesMatch ? 'MATCH' : 'DIFFERS'}`);
  for (const status of indexStatuses) {
    console.log(`- ${status.collectionGroup}: ${status.found ? status.state : 'MISSING'}`);
  }
  for (const unexpected of unexpectedIndexes) {
    console.log(`- unconfigured composite index: ${unexpected.name}`);
  }
  for (const unexpected of unexpectedFieldOverrides) {
    console.log(`- unconfigured field override: ${unexpected.collectionGroup}/${unexpected.fieldPath}`);
  }
  for (const status of fieldOverrideStatuses) {
    const state = status.matchesDesired
      ? (status.indexesDisabled ? 'EXEMPT' : 'READY')
      : status.pending
        ? 'PENDING'
        : 'DIFFERS';
    console.log(`- ${status.collectionGroup}/${status.fieldPath}: ${state}${progressSummary(status)}`);
  }
  process.exit(0);
}

// Unmanaged indexes are not authorized deletions. Refuse any automatic deploy,
// including when unrelated desired indexes or Rules need reconciliation.
requireNoUnexpectedCompositeIndexes(unexpectedIndexes);

if (mode === 'status') {
  if (!rulesMatch || missingIndexes.length || mismatchedFieldOverrides.length || unexpectedFieldOverrides.length) {
    if (!rulesMatch) console.log('Firestore reconciliation required: live Rules differ from firestore.rules.');
    for (const status of missingIndexes) {
      console.log(`Firestore reconciliation required: missing desired index ${status.collectionGroup}.`);
    }
    for (const status of mismatchedFieldOverrides) {
      console.log(`Firestore reconciliation required: field index override ${status.collectionGroup}/${status.fieldPath} differs from source.`);
    }
    for (const unexpected of unexpectedFieldOverrides) {
      console.log(`Firestore reconciliation required: unexpected field index override ${unexpected.collectionGroup}/${unexpected.fieldPath}.`);
    }
    process.exit(10);
  }

  if (pendingIndexes.length || pendingFieldOverrides.length) {
    const pendingParts = [
      ...pendingIndexes.map(item => `${item.collectionGroup}/${item.state ?? 'UNKNOWN'}`),
      ...pendingFieldOverrides.map(item => `${item.collectionGroup}/${item.fieldPath}${progressSummary(item)}`),
    ];
    console.log(
      `Firestore deployment already contains the desired configuration, but index operations are still converging: ${pendingParts.join(', ')}`,
    );
    process.exit(11);
  }

  console.log(`Firestore Production is already reconciled for project ${projectId}: live Rules match source, ${indexStatuses.length} desired composite indexes and ${fieldOverrideStatuses.length} explicit field indexes/exemptions are READY.`);
  process.exit(0);
}

if (!rulesMatch) {
  throw new Error('Live Cloud Firestore rules do not match firestore.rules from the deployed SHA');
}
if (unexpectedFieldOverrides.length) {
  throw new Error(
    `Firestore has explicit field index overrides not present in the desired configuration: ${unexpectedFieldOverrides.map(item => `${item.collectionGroup}/${item.fieldPath}`).join(', ')}`,
  );
}
if (mismatchedFieldOverrides.length) {
  throw new Error(
    `Desired Firestore field index overrides do not match live state: ${mismatchedFieldOverrides.map(item => `${item.collectionGroup}/${item.fieldPath}`).join(', ')}`,
  );
}
if (pendingFieldOverrides.length) {
  throw new Error(
    `Desired Firestore field index overrides are still converging: ${pendingFieldOverrides.map(item => `${item.collectionGroup}/${item.fieldPath}${progressSummary(item)}`).join(', ')}`,
  );
}

const pending = indexStatuses.filter(status => !status.found || status.state !== 'READY');
if (pending.length) {
  throw new Error(
    `Desired Firestore indexes are not READY: ${pending.map(item => `${item.collectionGroup}/${item.state ?? 'MISSING'}`).join(', ')}`,
  );
}

console.log(`Firestore Production verified for project ${projectId}: live rules match source, ${indexStatuses.length} desired composite indexes and ${fieldOverrideStatuses.length} explicit field indexes/exemptions are READY.`);
