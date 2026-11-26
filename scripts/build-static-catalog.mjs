import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateSeed } from './seed-catalog.mjs';

const MAX_DOCUMENT_BYTES = 800_000;
const VERSION_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

export function validateStaticItems(items, kind) {
  validateSeed(items, kind);
  const numericFields = kind === 'foods'
    ? ['baseQty', 'servingWeight', 'satFat', 'sugars', 'sodium', 'fiber', 'iron', 'potassium', 'calcium', 'magnesium', 'cholesterol']
    : ['equipmentWeight', 'setsCount'];
  const textFields = kind === 'foods'
    ? ['brand', 'category', 'unit', 'servingUnit'] : ['notes'];
  for (const item of items) {
    if (kind === 'exercises') {
      if (typeof item.id !== 'string' ||
          (item.trackingType !== undefined && !['weight_reps', 'time', 'cardio'].includes(item.trackingType)) ||
          ['muscles', 'secondaryMuscles'].some(key => item[key] !== undefined &&
            (!Array.isArray(item[key]) || item[key].some(value => typeof value !== 'string'))) ||
          ['isDefault', 'isBodyweight'].some(key => item[key] !== undefined && typeof item[key] !== 'boolean')) {
        throw new Error('exercises: campi opzionali o ID non conformi allo schema client');
      }
    } else if (item.isCustom !== undefined && typeof item.isCustom !== 'boolean') {
      throw new Error('foods: flag non conforme allo schema client');
    }
    if (numericFields.some(key => item[key] !== undefined && !(key === 'servingWeight' && item[key] === null) &&
        (typeof item[key] !== 'number' || !Number.isFinite(item[key]) || item[key] < 0)) ||
        textFields.some(key => item[key] !== undefined && typeof item[key] !== 'string')) {
      throw new Error(`${kind}: campi opzionali non conformi allo schema client`);
    }
  }
  return items;
}

function parseOptions(args) {
  const options = new Map();
  for (const arg of args) {
    if (arg === '--dry-run') {
      if (options.has('dry-run')) throw new Error('Opzione duplicata: dry-run');
      options.set('dry-run', true);
      continue;
    }
    const match = /^--(version|updated-at|exercises|foods|out-dir|confirm-version)=(.+)$/.exec(arg);
    if (!match || options.has(match[1])) throw new Error(`Argomento non valido o duplicato: ${arg}`);
    options.set(match[1], match[2]);
  }
  return options;
}

function documentFor(items, kind) {
  const bytes = Buffer.from(JSON.stringify({ items }), 'utf8');
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error(`${kind}: documento oltre il limite di ${MAX_DOCUMENT_BYTES} byte`);
  const digest = createHash('sha256').update(bytes).digest('hex');
  return { bytes, digest };
}

export async function prepareStaticCatalog({ version, updatedAt, exercisesPath, foodsPath }) {
  if (!VERSION_PATTERN.test(version ?? '') || version === '.' || version === '..') {
    throw new Error('Versione catalogo non valida');
  }
  if (typeof updatedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(updatedAt) ||
      !Number.isFinite(Date.parse(updatedAt)) || new Date(updatedAt).toISOString() !== updatedAt) {
    throw new Error('updated-at deve essere un istante UTC ISO 8601 canonico');
  }
  if (!exercisesPath || !foodsPath) throw new Error('Indicare due file JSON espliciti');
  const exercises = validateStaticItems(JSON.parse(await readFile(exercisesPath, 'utf8')), 'exercises');
  const foods = validateStaticItems(JSON.parse(await readFile(foodsPath, 'utf8')), 'foods');
  const documents = {
    exercises: documentFor(exercises, 'exercises'),
    foods: documentFor(foods, 'foods'),
  };
  const docRefs = Object.fromEntries(Object.entries(documents).map(([kind, doc]) =>
    [kind, `${kind}_${version}_${doc.digest}.json`]));
  const manifest = {
    version, updatedAt, schemaVersion: 1,
    docRefs,
    itemCounts: { exercises: exercises.length, foods: foods.length },
    digests: { exercises: documents.exercises.digest, foods: documents.foods.digest },
  };
  return { manifest, files: {
    [docRefs.exercises]: documents.exercises.bytes,
    [docRefs.foods]: documents.foods.bytes,
    'manifest.json': Buffer.from(JSON.stringify(manifest), 'utf8'),
  } };
}

export async function buildStaticCatalog(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  const version = options.get('version');
  const prepared = await prepareStaticCatalog({
    version,
    updatedAt: options.get('updated-at'),
    exercisesPath: options.get('exercises'),
    foodsPath: options.get('foods'),
  });
  if (options.has('dry-run')) {
    console.log(JSON.stringify({ dryRun: true, manifest: prepared.manifest }, null, 2));
    return prepared.manifest;
  }
  if (options.get('confirm-version') !== version || !options.get('out-dir')) {
    throw new Error('Scrittura negata: indicare --out-dir e --confirm-version uguale alla versione verificata');
  }
  const target = resolve(options.get('out-dir'));
  // mkdir without recursive protects an existing release from being overwritten.
  // The manifest is written last: incomplete staging must never look publishable.
  await mkdir(target);
  for (const [name, bytes] of Object.entries(prepared.files)) {
    if (name === 'manifest.json') continue;
    await writeFile(join(target, name), bytes, { flag: 'wx' });
  }
  await writeFile(join(target, 'manifest.json'), prepared.files['manifest.json'], { flag: 'wx' });
  console.log(JSON.stringify({ output: target, manifest: prepared.manifest }, null, 2));
  return prepared.manifest;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  buildStaticCatalog().catch(error => { console.error(error.message); process.exitCode = 1; });
}
