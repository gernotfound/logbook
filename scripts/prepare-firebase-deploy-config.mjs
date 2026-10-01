import { readFile, writeFile } from 'node:fs/promises';

const site = process.env.FIREBASE_HOSTING_SITE?.trim();
if (!site) throw new Error('FIREBASE_HOSTING_SITE mancante.');

const deletionApi = process.env.VITE_ACCOUNT_DELETION_API_URL?.trim();
if (!deletionApi) throw new Error('VITE_ACCOUNT_DELETION_API_URL mancante.');

const deletionOrigin = new URL(deletionApi).origin;
if (!deletionOrigin.endsWith('.cloudfunctions.net')) {
  throw new Error('VITE_ACCOUNT_DELETION_API_URL deve usare il dominio Cloud Functions atteso.');
}

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
    if (!header.value.includes('https://*.cloudfunctions.net')) {
      throw new Error('firebase.json: CSP Cloud Functions wildcard mancante.');
    }
    header.value = header.value.replace('https://*.cloudfunctions.net', deletionOrigin);
    cspUpdated = true;
  }
}
if (!cspUpdated) throw new Error('firebase.json: Content-Security-Policy mancante.');

await writeFile('.firebase-deploy.json', JSON.stringify(config, null, 2) + '\n', 'utf8');
console.log('Firebase deploy config prepared for site:', site, 'with Function origin:', deletionOrigin);
