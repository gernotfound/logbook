/**
 * seed-catalog.mjs
 * Popola la collezione global_catalog su Firestore con i seed locali.
 * Utilizzo: node seed-catalog.mjs
 */
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createRequire } from "module";
import { existsSync } from "fs";

const require = createRequire(import.meta.url);

const PROJECT_ID = "logbook-db-98cc4";
const SERVICE_ACCOUNT_PATH = "./service-account.json";

if (existsSync(SERVICE_ACCOUNT_PATH)) {
    const sa = require(SERVICE_ACCOUNT_PATH);
    initializeApp({ credential: cert(sa), projectId: PROJECT_ID });
    console.log("Autenticazione con service account.");
} else {
    initializeApp({ projectId: PROJECT_ID });
    console.log("Autenticazione con Application Default Credentials.");
}

const db = getFirestore();
const exercises = require("./src/lib/catalog/seedExercises.json");
const foods = require("./src/lib/catalog/seedFoods.json");

const manifest = {
    version: "1.0.0",
    updatedAt: new Date().toISOString(),
    schemaVersion: 1,
    docRefs: { exercises: "exercises_v1", foods: "foods_v1" },
    itemCounts: { exercises: exercises.length, foods: foods.length }
};

async function seedCatalog() {
    console.log(`Seeding global_catalog su Firestore (${PROJECT_ID})...`);
    console.log(`  Esercizi: ${exercises.length}`);
    console.log(`  Alimenti: ${foods.length}`);

    const col = db.collection("global_catalog");
    await col.doc("manifest").set(manifest);
    console.log("  manifest scritto.");
    await col.doc("exercises_v1").set({ items: exercises });
    console.log("  exercises_v1 scritto.");
    await col.doc("foods_v1").set({ items: foods });
    console.log("  foods_v1 scritto.");
    console.log("Seeding completato!");
    process.exit(0);
}

seedCatalog().catch((err) => {
    console.error("Errore durante il seeding:", err.message);
    process.exit(1);
});
