import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const expectedSha = process.env.EXPECTED_SHA?.trim();
if (!expectedSha || !/^[a-f0-9]{40}$/.test(expectedSha)) {
  throw new Error('EXPECTED_SHA deve essere uno SHA Git completo.');
}

const root = process.cwd();
const output = join(root, '.firebase-release');
const requiredPaths = [
  'dist/index.html',
  '.firebase-deploy.json',
  'firestore.rules',
  'functions/package.json',
  'functions/package-lock.json',
  'functions/.env',
  'functions/lib/index.js',
  'functions/node_modules/firebase-functions/package.json',
  'functions/node_modules/firebase-admin/package.json',
  'tools/firebase-deploy/package.json',
  'tools/firebase-deploy/node_modules/firebase-tools/package.json',
];

for (const relative of requiredPaths) {
  if (!existsSync(join(root, relative))) {
    throw new Error(`Firebase release input mancante: ${relative}`);
  }
}

const cliPackage = JSON.parse(
  await readFile(join(root, 'tools/firebase-deploy/node_modules/firebase-tools/package.json'), 'utf8'),
);
if (cliPackage.version !== '15.32.0') {
  throw new Error('La Firebase CLI del release artifact non corrisponde alla versione pinnata.');
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const deployConfig = JSON.parse(await readFile(join(root, '.firebase-deploy.json'), 'utf8'));
const functionConfigs = Array.isArray(deployConfig.functions) ? deployConfig.functions : [deployConfig.functions];
for (const functionConfig of functionConfigs.filter(Boolean)) delete functionConfig.predeploy;
await writeFile(join(output, 'firebase.json'), JSON.stringify(deployConfig, null, 2) + '\n', 'utf8');
await cp(join(root, 'firestore.rules'), join(output, 'firestore.rules'));
await cp(join(root, 'dist'), join(output, 'dist'), { recursive: true, dereference: true });

await mkdir(join(output, 'functions'), { recursive: true });
for (const name of ['package.json', 'package-lock.json', '.env']) {
  await cp(join(root, 'functions', name), join(output, 'functions', name));
}
await cp(join(root, 'functions', 'lib'), join(output, 'functions', 'lib'), { recursive: true, dereference: true });
await cp(join(root, 'functions', 'node_modules'), join(output, 'functions', 'node_modules'), { recursive: true, dereference: true });

await mkdir(join(output, 'tools', 'firebase-deploy'), { recursive: true });
await cp(join(root, 'tools', 'firebase-deploy', 'package.json'), join(output, 'tools', 'firebase-deploy', 'package.json'));
await cp(join(root, 'tools', 'firebase-deploy', 'node_modules'), join(output, 'tools', 'firebase-deploy', 'node_modules'), { recursive: true, dereference: true });

await writeFile(join(output, 'verified-sha.txt'), expectedSha + '\n', 'utf8');
console.log('Firebase release directory prepared for exact SHA.');
