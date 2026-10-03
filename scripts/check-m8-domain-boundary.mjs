import fs from 'node:fs';
import path from 'node:path';

const roots = ['src/hooks', 'src/components'];
const allowedSnapshotSelectors = new Map([
  ['src/hooks/useSettings.ts', 1], // Bulk JSON import only; profile edits use DomainOperation.
]);

const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full.replaceAll('\\', '/'));
  }
}
for (const root of roots) walk(root);

const violations = [];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const selectorMatches = [...source.matchAll(/useAppStore\s*\(\s*[^=()]+=>\s*[^)]+\.(saveUserData|updateUserData)\s*\)/g)];
  const getStateMatches = [...source.matchAll(/useAppStore\.getState\(\)\.(saveUserData|updateUserData)/g)];
  const directCommitMatches = [...source.matchAll(/\bcommitLocal\s*\(/g)];
  const count = selectorMatches.length + getStateMatches.length + directCommitMatches.length;
  const allowed = allowedSnapshotSelectors.get(file) ?? 0;
  if (count !== allowed) {
    violations.push(`${file}: found ${count} direct snapshot/journal mutation reference(s), allowed ${allowed}`);
  }
}

for (const [file, expected] of allowedSnapshotSelectors) {
  if (!files.includes(file)) violations.push(`${file}: documented bulk-boundary allowlist file missing`);
  if (expected < 1) violations.push(`${file}: invalid allowlist count`);
}

// Persisted UserData may only be installed/mutated by the data/sync implementation
// boundaries. A device-local slice must never mirror cloud-facing business state.
const allowedUserDataWriterSlices = new Set([
  'src/store/slices/createDataSlice.ts',
  'src/store/slices/createSyncSlice.ts',
]);
for (const entry of fs.readdirSync('src/store/slices', { withFileTypes: true })) {
  if (!entry.isFile() || !/\.ts$/.test(entry.name)) continue;
  const file = `src/store/slices/${entry.name}`;
  if (allowedUserDataWriterSlices.has(file)) continue;
  const source = fs.readFileSync(file, 'utf8');
  if (/\buserData\s*:/.test(source)) {
    violations.push(`${file}: unauthorized UserData write outside data/sync boundary`);
  }
}

const workoutSession = fs.readFileSync('src/hooks/useWorkoutSession.ts', 'utf8');
const workoutSlice = fs.readFileSync('src/store/slices/createWorkoutSlice.ts', 'utf8');
for (const [label, source, pattern] of [
  ['active workout synced selector', workoutSession, /state => state\.setSyncedLocalWorkout/],
  ['active workout mutation adapter', workoutSession, /setLocalWorkout:\s*mutateActiveWorkout/],
  ['active workout start path', workoutSession, /mutateActiveWorkout\(newActiveWorkout\)/],
  ['active workout domain dispatch', workoutSlice, /dispatchDomainOperation\(\{ type: 'active-workout\.set', workout: persistedWorkout \}\)/],
]) {
  if (!pattern.test(source)) violations.push(`${label}: missing M8 active-workout DomainOperation boundary`);
}

if (violations.length) {
  console.error('M8 Domain Operation boundary violations:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(`M8 Domain Operation boundary OK (${files.length} hook/component files + store-slice ownership checked).`);
