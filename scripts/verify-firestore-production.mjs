import { readFileSync } from 'node:fs';

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

const normalizedDesiredFields = fields =>
  fields.map(field => {
    if (field.order) return { fieldPath: field.fieldPath, order: field.order };
    if (field.arrayConfig) return { fieldPath: field.fieldPath, arrayConfig: field.arrayConfig };
    if (field.vectorConfig) return { fieldPath: field.fieldPath, vectorConfig: field.vectorConfig };
    throw new Error(`Unsupported desired index field: ${JSON.stringify(field)}`);
  });

const normalizedLiveFields = fields =>
  fields
    .filter(field => field.fieldPath !== '__name__')
    .map(field => {
      if (field.order) return { fieldPath: field.fieldPath, order: field.order };
      if (field.arrayConfig) return { fieldPath: field.fieldPath, arrayConfig: field.arrayConfig };
      if (field.vectorConfig) return { fieldPath: field.fieldPath, vectorConfig: field.vectorConfig };
      throw new Error(`Unsupported live index field: ${JSON.stringify(field)}`);
    });

const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const loadLiveIndexes = async collectionGroup => {
  const indexes = [];
  let pageToken = '';

  do {
    const parent = `projects/${projectId}/databases/(default)/collectionGroups/${encodeURIComponent(collectionGroup)}`;
    const url = new URL(`https://firestore.googleapis.com/v1/${parent}/indexes`);
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const payload = await requestJson(url.toString());
    indexes.push(...(payload.indexes ?? []));
    pageToken = payload.nextPageToken ?? '';
  } while (pageToken);

  return indexes;
};

const normalizeDesiredFieldOverride = override => {
  if (!override?.collectionGroup || !override?.fieldPath || !Array.isArray(override.indexes)) {
    throw new Error(`Invalid desired field override: ${JSON.stringify(override)}`);
  }
  if (override.indexes.length !== 0) {
    throw new Error(`Production verifier currently supports explicit index exemptions only: ${JSON.stringify(override)}`);
  }
  return {
    collectionGroup: override.collectionGroup,
    fieldPath: override.fieldPath,
  };
};

const fieldPathFromName = name => {
  const marker = '/fields/';
  const index = String(name ?? '').lastIndexOf(marker);
  return index < 0 ? '' : decodeURIComponent(String(name).slice(index + marker.length));
};

const loadLiveFieldOverrides = async collectionGroup => {
  const fields = [];
  let pageToken = '';

  do {
    const parent = `projects/${projectId}/databases/(default)/collectionGroups/${encodeURIComponent(collectionGroup)}`;
    const url = new URL(`https://firestore.googleapis.com/v1/${parent}/fields`);
    url.searchParams.set('filter', 'indexConfig.usesAncestorConfig:false');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const payload = await requestJson(url.toString());
    fields.push(...(payload.fields ?? []));
    pageToken = payload.nextPageToken ?? '';
  } while (pageToken);

  return fields;
};

const desiredFieldOverrides = indexConfig.fieldOverrides.map(normalizeDesiredFieldOverride);

const desiredByGroup = new Map();
for (const desired of indexConfig.indexes) {
  if (!desired.collectionGroup || !desired.queryScope || !Array.isArray(desired.fields)) {
    throw new Error(`Invalid desired index: ${JSON.stringify(desired)}`);
  }
  const group = desired.collectionGroup;
  if (!desiredByGroup.has(group)) desiredByGroup.set(group, []);
  desiredByGroup.get(group).push(desired);
}

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

const indexStatuses = [];
for (const [collectionGroup, desiredIndexes] of desiredByGroup) {
  const liveIndexes = await loadLiveIndexes(collectionGroup);

  for (const desired of desiredIndexes) {
    const desiredFields = normalizedDesiredFields(desired.fields);
    const live = liveIndexes.find(candidate =>
      candidate.queryScope === desired.queryScope &&
      sameJson(normalizedLiveFields(candidate.fields ?? []), desiredFields),
    );

    indexStatuses.push({
      collectionGroup,
      queryScope: desired.queryScope,
      fields: desiredFields,
      found: Boolean(live),
      state: live?.state ?? null,
    });
  }
}

const fieldOverrideStatuses = [];
for (const collectionGroup of [...new Set(desiredFieldOverrides.map(item => item.collectionGroup))]) {
  const liveFields = await loadLiveFieldOverrides(collectionGroup);
  for (const desired of desiredFieldOverrides.filter(item => item.collectionGroup === collectionGroup)) {
    const live = liveFields.find(field => fieldPathFromName(field.name) === desired.fieldPath);
    const indexConfigLive = live?.indexConfig;
    const indexes = Array.isArray(indexConfigLive?.indexes) ? indexConfigLive.indexes : [];
    fieldOverrideStatuses.push({
      ...desired,
      found: Boolean(live),
      explicit: indexConfigLive?.usesAncestorConfig === false,
      reverting: indexConfigLive?.reverting === true,
      indexesDisabled: Boolean(live) && indexes.length === 0,
    });
  }
}

const rulesMatch = normalizeText(liveRulesFile.content) === normalizeText(rulesSource);
const missingIndexes = indexStatuses.filter(status => !status.found);
const pendingIndexes = indexStatuses.filter(status => status.found && status.state !== 'READY');
const mismatchedFieldOverrides = fieldOverrideStatuses.filter(status =>
  !status.found || !status.explicit || status.reverting || !status.indexesDisabled
);

if (mode === 'preflight') {
  console.log(`Firestore deploy preflight OK for project ${projectId}: authenticated Rules/Index read access confirmed.`);
  console.log(`- rules: ${rulesMatch ? 'MATCH' : 'DIFFERS'}`);
  for (const status of indexStatuses) {
    console.log(`- ${status.collectionGroup}: ${status.found ? status.state : 'MISSING'}`);
  }
  for (const status of fieldOverrideStatuses) {
    console.log(`- ${status.collectionGroup}/${status.fieldPath}: ${status.found && status.explicit && status.indexesDisabled && !status.reverting ? 'EXEMPT' : 'DIFFERS'}`);
  }
  process.exit(0);
}

if (mode === 'status') {
  if (!rulesMatch || missingIndexes.length || mismatchedFieldOverrides.length) {
    if (!rulesMatch) console.log('Firestore reconciliation required: live Rules differ from firestore.rules.');
    for (const status of missingIndexes) {
      console.log(`Firestore reconciliation required: missing desired index ${status.collectionGroup}.`);
    }
    for (const status of mismatchedFieldOverrides) {
      console.log(`Firestore reconciliation required: field exemption ${status.collectionGroup}/${status.fieldPath} differs from source.`);
    }
    process.exit(10);
  }

  if (pendingIndexes.length) {
    console.log(
      `Firestore deployment already contains the desired configuration, but indexes are still converging: ${pendingIndexes.map(item => `${item.collectionGroup}/${item.state ?? 'UNKNOWN'}`).join(', ')}`,
    );
    process.exit(11);
  }

  console.log(`Firestore Production is already reconciled for project ${projectId}: live Rules match source, ${indexStatuses.length} desired composite indexes are READY, and ${fieldOverrideStatuses.length} field exemptions match.`);
  process.exit(0);
}

if (!rulesMatch) {
  throw new Error('Live Cloud Firestore rules do not match firestore.rules from the deployed SHA');
}
if (mismatchedFieldOverrides.length) {
  throw new Error(
    `Desired Firestore field exemptions do not match live state: ${mismatchedFieldOverrides.map(item => `${item.collectionGroup}/${item.fieldPath}`).join(', ')}`,
  );
}

const pending = indexStatuses.filter(status => !status.found || status.state !== 'READY');
if (pending.length) {
  throw new Error(
    `Desired Firestore indexes are not READY: ${pending.map(item => `${item.collectionGroup}/${item.state ?? 'MISSING'}`).join(', ')}`,
  );
}

console.log(`Firestore Production verified for project ${projectId}: live rules match source, ${indexStatuses.length} desired composite indexes are READY, and ${fieldOverrideStatuses.length} field exemptions match.`);
