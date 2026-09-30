import { readFile, writeFile } from 'node:fs/promises';

const site = process.env.FIREBASE_HOSTING_SITE?.trim();
if (!site) throw new Error('FIREBASE_HOSTING_SITE mancante.');

const config = JSON.parse(await readFile('firebase.json', 'utf8'));
if (!config.hosting || Array.isArray(config.hosting)) {
  throw new Error('firebase.json: configurazione Hosting inattesa.');
}

config.hosting = {
  ...config.hosting,
  site,
};
delete config.hosting.target;

await writeFile('.firebase-deploy.json', JSON.stringify(config, null, 2) + '\n', 'utf8');
console.log('Firebase deploy config prepared for site:', site);
