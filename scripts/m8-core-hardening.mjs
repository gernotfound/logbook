import fs from 'node:fs';

function replaceOne(path, from, to) {
  const source = fs.readFileSync(path, 'utf8');
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`${path}: expected exactly one match, found ${count}`);
  fs.writeFileSync(path, source.replace(from, to), 'utf8');
}

replaceOne(
  'src/lib/sync/domainOperations.ts',
  `function upsertById<T>(items: readonly T[] | undefined, item: T, identity: (value: T) => string, label: string): T[] {`,
  `function applyPatch<T extends Record<string, unknown>>(target: T, patch: Partial<T>): T {\n    const result = { ...target };\n    for (const [key, value] of Object.entries(patch)) {\n        if (value === undefined) delete result[key];\n        else result[key] = value;\n    }\n    return result;\n}\n\nfunction upsertById<T>(items: readonly T[] | undefined, item: T, identity: (value: T) => string, label: string): T[] {`,
);
replaceOne(
  'src/lib/sync/domainOperations.ts',
  `            data.profile = { ...(data.profile ?? {}), ...operation.patch };`,
  `            data.profile = applyPatch(data.profile ?? {}, operation.patch);`,
);
replaceOne(
  'src/lib/sync/domainOperations.ts',
  `            data.nutrition = { ...(data.nutrition ?? {}), [date]: { ...day, ...operation.patch, date } };`,
  `            const patched = applyPatch(day as unknown as Record<string, unknown>, operation.patch as Record<string, unknown>) as unknown as NutritionDay;\n            data.nutrition = { ...(data.nutrition ?? {}), [date]: { ...patched, date } };`,
);
replaceOne(
  'src/lib/sync/domainOperations.ts',
  `            data.library = upsertById(data.library, exercise, item => requireId(item.id, 'Esercizio'), 'Archivio esercizi');`,
  `            data.library = upsertById(data.library, exercise, item => requireId(item.id, 'Esercizio'), 'Archivio esercizi')\n                .sort((a, b) => a.name.localeCompare(b.name, 'it'));`,
);
replaceOne(
  'src/hooks/useTrainingExercises.ts',
  `            const updatedLibrary = library.filter(ex => ex.id !== id);\n            try {`,
  `            try {`,
);
replaceOne(
  'src/hooks/useTrainingExercises.ts',
  `            const updatedLibrary = library.map(ex => ex.id === id ? { ...originalEx } : ex);\n            try {`,
  `            try {`,
);

console.log('M8 core hardening applied');
