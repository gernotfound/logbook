import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildStaticCatalog, prepareStaticCatalog } from '../../scripts/build-static-catalog.mjs';

let root;
let exercisesPath;
let foodsPath;
const version = 'candidate-1';
const updatedAt = '2026-11-26T10:00:00.000Z';
const exercise = { id: 'syn-ex-1', name: 'Synthetic squat', trackingType: 'weight_reps' };
const food = { id: 'syn-food-1', name: 'Synthetic oats', kcal: 100, pro: 4, carbs: 17, fat: 2 };
const args = () => [
  `--version=${version}`, `--updated-at=${updatedAt}`,
  `--exercises=${exercisesPath}`, `--foods=${foodsPath}`,
];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'logbook-static-catalog-'));
  exercisesPath = join(root, 'exercises.json');
  foodsPath = join(root, 'foods.json');
  await writeFile(exercisesPath, JSON.stringify([exercise]));
  await writeFile(foodsPath, JSON.stringify([food]));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test('generates immutable documents with raw-byte SHA-256 digests and publishes manifest last', async () => {
  const out = join(root, 'release');
  const oldLog = console.log;
  console.log = () => {};
  try { await buildStaticCatalog([...args(), `--out-dir=${out}`, `--confirm-version=${version}`]); }
  finally { console.log = oldLog; }
  const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, version);
  assert.deepEqual(manifest.itemCounts, { exercises: 1, foods: 1 });
  assert.equal((await readdir(out)).length, 3);
  for (const kind of ['exercises', 'foods']) {
    const bytes = await readFile(join(out, manifest.docRefs[kind]));
    const digest = createHash('sha256').update(bytes).digest('hex');
    assert.equal(digest, manifest.digests[kind]);
    assert.equal(manifest.docRefs[kind], `${kind}_${version}_${digest}.json`);
    assert.equal(JSON.parse(bytes.toString()).items.length, 1);
  }
  await assert.rejects(buildStaticCatalog([...args(), `--out-dir=${out}`, `--confirm-version=${version}`]), /EEXIST/);
  assert.equal((await readdir(out)).length, 3);
});

test('dry-run is read-only even with a target and rejects a missing write confirmation', async () => {
  const target = join(root, 'unpublished');
  const oldLog = console.log;
  console.log = () => {};
  try { await buildStaticCatalog([...args(), `--out-dir=${target}`, '--dry-run']); }
  finally { console.log = oldLog; }
  assert.deepEqual((await readdir(root)).sort(), ['exercises.json', 'foods.json']);
  await assert.rejects(buildStaticCatalog([...args(), `--out-dir=${target}`]), /Scrittura negata/);
  assert.deepEqual((await readdir(root)).sort(), ['exercises.json', 'foods.json']);
});

test('rejects empty bundles, duplicate IDs, bad nutritional data, invalid version and noncanonical timestamp', async () => {
  await writeFile(exercisesPath, '[]');
  await assert.rejects(prepareStaticCatalog({ version, updatedAt, exercisesPath, foodsPath }), /vuoto/);
  await writeFile(exercisesPath, JSON.stringify([exercise, { ...exercise }]));
  await assert.rejects(prepareStaticCatalog({ version, updatedAt, exercisesPath, foodsPath }), /duplicato/);
  await writeFile(exercisesPath, JSON.stringify([exercise]));
  await writeFile(foodsPath, JSON.stringify([{ ...food, kcal: -1 }]));
  await assert.rejects(prepareStaticCatalog({ version, updatedAt, exercisesPath, foodsPath }), /macronutrienti/);
  await writeFile(foodsPath, JSON.stringify([food]));
  await assert.rejects(prepareStaticCatalog({ version: '../escape', updatedAt, exercisesPath, foodsPath }), /Versione/);
  await assert.rejects(prepareStaticCatalog({ version, updatedAt: '2026-02-30T10:00:00.000Z', exercisesPath, foodsPath }), /updated-at/);
});

test('rejects lossy schema fallbacks before signing a static release', async () => {
  await writeFile(exercisesPath, JSON.stringify([{ ...exercise, id: 123 }]));
  await assert.rejects(prepareStaticCatalog({ version, updatedAt, exercisesPath, foodsPath }), /schema client/);
  await writeFile(exercisesPath, JSON.stringify([{ ...exercise, trackingType: 'broken' }]));
  await assert.rejects(prepareStaticCatalog({ version, updatedAt, exercisesPath, foodsPath }), /schema client/);
  await writeFile(exercisesPath, JSON.stringify([exercise]));
  await writeFile(foodsPath, JSON.stringify([{ ...food, servingWeight: -8 }]));
  await assert.rejects(prepareStaticCatalog({ version, updatedAt, exercisesPath, foodsPath }), /schema client/);
});

test('rejects files that exceed the existing 800 KB document budget before any output is created', async () => {
  await writeFile(exercisesPath, JSON.stringify([{ ...exercise, notes: 'x'.repeat(800_000) }]));
  await assert.rejects(buildStaticCatalog([...args(), `--out-dir=${join(root, 'oversized')}`, `--confirm-version=${version}`]), /troppo grande|limite/);
  assert.deepEqual((await readdir(root)).sort(), ['exercises.json', 'foods.json']);
});

test('rejects an already existing empty output directory', async () => {
  const out = join(root, 'already-exists');
  await mkdir(out);
  await assert.rejects(buildStaticCatalog([...args(), `--out-dir=${out}`, `--confirm-version=${version}`]), /EEXIST/);
  assert.deepEqual(await readdir(out), []);
});
