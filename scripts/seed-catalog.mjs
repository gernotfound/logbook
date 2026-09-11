import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function validateSeed(items, kind) {
    if (!Array.isArray(items) || !items.length) throw new Error(`${kind}: seed vuoto o non valido; nessuna scrittura consentita.`);
    const ids = new Set();
    for (const item of items) {
        if (!item || typeof item !== 'object' || !((typeof item.id === 'string' && item.id.trim()) || (typeof item.id === 'number' && Number.isFinite(item.id))) || typeof item.name !== 'string' || !item.name.trim()) throw new Error(`${kind}: ogni elemento richiede ID e nome validi.`);
        if (ids.has(String(item.id))) throw new Error(`${kind}: ID duplicato ${item.id}.`);
        ids.add(String(item.id));
        if (kind === 'foods' && ['kcal', 'pro', 'carbs', 'fat'].some(key => typeof item[key] !== 'number' || !Number.isFinite(item[key]) || item[key] < 0)) throw new Error('foods: macronutrienti non validi.');
    }
    // Leave room for the Firestore document metadata and encoding overhead.
    if (Buffer.byteLength(JSON.stringify({ items }), 'utf8') > 800_000) throw new Error(`${kind}: documento troppo grande, occorre un formato paginato.`);
    return items;
}

export async function seedCatalog(args = process.argv.slice(2)) {
    const options = new Map();
    for (const arg of args) {
        const match = /^--(project|version|exercises|foods|service-account|confirm)=(.+)$/.exec(arg);
        if (match) options.set(match[1], match[2]);
        else if (arg === '--dry-run') options.set('dry-run', true);
        else throw new Error(`Argomento non riconosciuto: ${arg}`);
    }
    const exercises = validateSeed(JSON.parse(await readFile(options.get('exercises') ?? new URL('../src/lib/catalog/seedExercises.json', import.meta.url), 'utf8')), 'exercises');
    const foods = validateSeed(JSON.parse(await readFile(options.get('foods') ?? new URL('../src/lib/catalog/seedFoods.json', import.meta.url), 'utf8')), 'foods');
    const project = options.get('project');
    const version = options.get('version');
    if (!project || !version || !/^[a-zA-Z0-9._-]+$/.test(version)) throw new Error('Indicare --project e --version (solo lettere, numeri, punto, trattino).');
    const manifest = { version, updatedAt: new Date().toISOString(), schemaVersion: 1,
        docRefs: { exercises: 'exercises_' + version, foods: 'foods_' + version },
        itemCounts: { exercises: exercises.length, foods: foods.length } };
    if (options.has('dry-run')) {
        console.log(JSON.stringify({ dryRun: true, project, manifest }, null, 2));
        return;
    }
    if (options.get('confirm') !== project) throw new Error('Scrittura non autorizzata: usare --dry-run oppure --confirm uguale al progetto esplicito.');
    // No credentials or Admin SDK are loaded during validation and dry-run.
    const { initializeApp, cert, deleteApp } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    const credentialsPath = options.get('service-account');
    const credentials = credentialsPath ? JSON.parse(await readFile(credentialsPath, 'utf8')) : null;
    if (credentials && credentials.project_id !== project) throw new Error('Il service account appartiene a un progetto differente.');
    const app = initializeApp({ projectId: project, ...(credentials ? { credential: cert(credentials) } : {}) });
    try {
        const db = getFirestore(app);
        const catalog = db.collection('global_catalog');
        await db.runTransaction(async transaction => {
            const oldManifest = await transaction.get(catalog.doc('manifest'));
            // create() prevents reusing a version and mutating documents referenced by older clients.
            transaction.create(catalog.doc(manifest.docRefs.exercises), { items: exercises });
            transaction.create(catalog.doc(manifest.docRefs.foods), { items: foods });
            if (oldManifest.exists) transaction.create(catalog.doc('previous_manifest_' + version), oldManifest.data());
            transaction.set(catalog.doc('manifest'), manifest);
        });
        console.log(`Catalogo ${version} pubblicato su ${project}; manifest precedente conservato.`);
    } finally { await deleteApp(app); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    seedCatalog().catch(error => { console.error(error.message); process.exitCode = 1; });
}
