import { readFile, writeFile } from 'node:fs/promises';

const site = process.env.FIREBASE_HOSTING_SITE?.trim();
if (!site) throw new Error('FIREBASE_HOSTING_SITE mancante.');

const deletionApi = process.env.VITE_ACCOUNT_DELETION_API_URL?.trim();
if (!deletionApi) throw new Error('VITE_ACCOUNT_DELETION_API_URL mancante.');

const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
if (!projectId) throw new Error('FIREBASE_PROJECT_ID mancante.');

const functionRegion = process.env.FIREBASE_FUNCTION_REGION?.trim();
if (!functionRegion) throw new Error('FIREBASE_FUNCTION_REGION mancante.');

const deletionUrl = new URL(deletionApi);
const expectedFunctionHost = `${functionRegion}-${projectId}.cloudfunctions.net`;
if (
  deletionUrl.protocol !== 'https:'
  || deletionUrl.hostname !== expectedFunctionHost
  || deletionUrl.pathname !== '/accountDeletion'
  || deletionUrl.username
  || deletionUrl.password
  || deletionUrl.port
  || deletionUrl.search
  || deletionUrl.hash
) {
  throw new Error('VITE_ACCOUNT_DELETION_API_URL non corrisponde alla Function accountDeletion configurata.');
}
const deletionOrigin = deletionUrl.origin;
const functionOriginPlaceholder = 'https://logbook-function.invalid';

const config = JSON.parse(await readFile('firebase.json', 'utf8'));
if (!config.hosting || Array.isArray(config.hosting)) {
  throw new Error('firebase.json: configurazione Hosting inattesa.');
}

config.hosting = {
  ...config.hosting,
  site,
};
delete config.hosting.target;

let cspUpdated = false;
for (const group of config.hosting.headers ?? []) {
  for (const header of group.headers ?? []) {
    if (header.key !== 'Content-Security-Policy') continue;
    const tokens = String(header.value).split(/\s+/).filter(Boolean);
    const placeholderCount = tokens.filter(token => token === functionOriginPlaceholder).length;
    if (placeholderCount !== 1) {
      throw new Error('firebase.json: la CSP deve contenere esattamente un placeholder Function isolato.');
    }
    if (tokens.includes('https://*.cloudfunctions.net')) {
      throw new Error('firebase.json: wildcard Cloud Functions non ammesso nel template Production.');
    }
    header.value = tokens
      .map(token => token === functionOriginPlaceholder ? deletionOrigin : token)
      .join(' ');
    cspUpdated = true;
  }
}
if (!cspUpdated) throw new Error('firebase.json: Content-Security-Policy mancante.');

await writeFile('.firebase-deploy.json', JSON.stringify(config, null, 2) + '\n', 'utf8');
console.log('Firebase deploy config prepared for site:', site, 'with Function origin:', deletionOrigin);
