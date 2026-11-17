import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  FIELD_OVERRIDE_LIST_FILTER,
  fieldOverrideListParent,
  findUnexpectedFieldOverrides,
  planRetiredFieldOverrides,
} from './firestore-production-state.mjs';

const projectId = process.env.FIREBASE_PROJECT_ID;
const accessToken = process.env.GCP_ACCESS_TOKEN;
if (!projectId || !/^[a-z0-9-]+$/.test(projectId) || !accessToken) {
  throw new Error('Firestore project and privileged access token are required');
}

const desired = JSON.parse(readFileSync('firestore.indexes.json', 'utf8')).fieldOverrides;
// The last two revisions of the index manifest are the authoritative
// before/after change, even if a corrective code-only release follows the removal.
// Only overrides removed by that manifest change are candidates for retirement.
const revisions = execFileSync('git', ['log', '-2', '--format=%H', '--', 'firestore.indexes.json'],
  { encoding: 'utf8' }).trim().split('\n');
if (revisions.length !== 2) throw new Error('Missing previous Firestore index manifest revision');
const previous = JSON.parse(execFileSync('git', ['show', `${revisions[1]}:firestore.indexes.json`],
  { encoding: 'utf8' })).fieldOverrides;
if (!Array.isArray(previous) || !Array.isArray(desired)) {
  throw new Error('Cannot determine old and new Firestore field overrides');
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Firestore field operation HTTP ${response.status}: ${body.slice(0, 350)}`);
  return body ? JSON.parse(body) : {};
}

async function readLiveFields() {
  const fields = [];
  let token = '';
  do {
    const url = new URL(`https://firestore.googleapis.com/v1/${fieldOverrideListParent(projectId)}/fields`);
    url.searchParams.set('filter', FIELD_OVERRIDE_LIST_FILTER);
    if (token) url.searchParams.set('pageToken', token);
    const result = await requestJson(url.toString());
    fields.push(...(result.fields ?? []));
    token = result.nextPageToken ?? '';
  } while (token);
  return fields;
}

const initial = await readLiveFields();
const retire = planRetiredFieldOverrides(previous, desired, initial);
for (const item of retire) {
  if (item.reverting) continue;
  const resource = `projects/${projectId}/databases/(default)/collectionGroups/${item.collectionGroup}/fields/${item.fieldPath}`;
  const url = new URL(`https://firestore.googleapis.com/v1/${resource}`);
  url.searchParams.set('updateMask', 'indexConfig');
  // Clear only the indexConfig of this explicitly retired field; never touch
  // TTL settings, other index overrides, collections or document contents.
  const operation = await requestJson(url.toString(), { method: 'PATCH',
    body: JSON.stringify({ name: resource }) });
  if (!operation.name || operation.error) throw new Error(`Firestore did not accept retirement of ${item.collectionGroup}/${item.fieldPath}`);
  console.log(`Requested index retirement: ${item.collectionGroup}/${item.fieldPath}`);
}

// Deploying indexes non-interactively while a field is reverting can prompt
// for deletion and leave stale overrides behind. Wait for the REST readback.
for (let attempt = 0; attempt <= 60; attempt++) {
  const live = await readLiveFields();
  const remaining = findUnexpectedFieldOverrides(desired, live);
  if (remaining.length === 0) {
    console.log('Firestore retired field index overrides are absent from the live configuration.');
    process.exit(0);
  }
  if (attempt === 60) throw new Error('Firestore field index retirement did not converge');
  await new Promise(resolve => setTimeout(resolve, 5000));
}
