import { readFileSync } from 'node:fs';

const mode = process.argv[2] ?? 'verify';
const projectId = process.env.FIREBASE_PROJECT_ID;
const accessToken = process.env.GCP_ACCESS_TOKEN;

if (!projectId) throw new Error('FIREBASE_PROJECT_ID is required');
if (!accessToken) throw new Error('GCP_ACCESS_TOKEN is required');
if (!['preflight', 'verify'].includes(mode)) throw new Error(`Unsupported mode: ${mode}`);

const rulesSource = readFileSync('firestore.rules', 'utf8');
const indexConfig = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'));

if (!Array.isArray(indexConfig.indexes)) throw new Error('firestore.indexes.json must contain an indexes array');
if (!Array.isArray(indexConfig.fieldOverrides)) throw new Error('firestore.indexes.json must contain a fieldOverrides array');
if (indexConfig.fieldOverrides.length !== 0) {
  throw new Error('Production verifier does not yet support fieldOverrides; extend verification before deploying them');
}

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

if (mode === 'preflight') {
  console.log(`Firestore deploy preflight OK for project ${projectId}: authenticated Rules/Index read access confirmed.`);
  for (const status of indexStatuses) {
    console.log(`- ${status.collectionGroup}: ${status.found ? status.state : 'MISSING (will be created)'}`);
  }
  process.exit(0);
}

const ruleset = await requestJson(
  `https://firebaserules.googleapis.com/v1/${release.rulesetName}`,
);
const liveRulesFile = (ruleset.source?.files ?? []).find(file => file.name === 'firestore.rules')
  ?? (ruleset.source?.files ?? [])[0];
if (!liveRulesFile?.content) throw new Error('Live Cloud Firestore ruleset source is unavailable');

if (normalizeText(liveRulesFile.content) !== normalizeText(rulesSource)) {
  throw new Error('Live Cloud Firestore rules do not match firestore.rules from the deployed SHA');
}

const pending = indexStatuses.filter(status => !status.found || status.state !== 'READY');
if (pending.length) {
  throw new Error(
    `Desired Firestore indexes are not READY: ${pending.map(item => `${item.collectionGroup}/${item.state ?? 'MISSING'}`).join(', ')}`,
  );
}

console.log(`Firestore Production verified for project ${projectId}: live rules match source and ${indexStatuses.length} desired composite indexes are READY.`);
