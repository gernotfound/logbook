// A mutation diagnostic must never silently run with missing or misrouted tests.
// This selection is outside the canonical test gate, so validate it during discovery.
const testFile = /\.test\.(?:ts|tsx)$/;
export function validateMutationSelection(trials, trackedPaths) {
  const tracked = new Set(trackedPaths);
  const errors = [];
  for (const [area, config] of Object.entries(trials)) {
    const { testFiles, mutate, runner } = config;
    if (!Array.isArray(testFiles) || testFiles.length === 0) {
      errors.push(area + ': no mutation test files selected');
      continue;
    }
    if (!Array.isArray(mutate) || mutate.length === 0) errors.push(area + ': no mutation targets');
    if (runner !== undefined && !['isolated', 'gc'].includes(runner)) errors.push(area + ': unknown mutation runner ' + runner);
    const selected = new Set();
    for (const file of testFiles) {
      if (typeof file !== 'string' || !testFile.test(file) || !tracked.has(file)) {
        errors.push(area + ': missing/invalid mutation test ' + String(file));
        continue;
      }
      if (selected.has(file)) errors.push(area + ': duplicate mutation test ' + file);
      selected.add(file);
      const isolated = file.startsWith('tests/isolated/');
      const gc = file.startsWith('tests/gc/');
      if (runner === 'isolated' && (!isolated || !file.endsWith('.test.ts'))) {
        errors.push(area + ': isolated runner mismatch ' + file);
      } else if (runner === 'gc' && (!gc || !file.endsWith('.test.ts'))) {
        errors.push(area + ': gc runner mismatch ' + file);
      } else if (!runner && (/^tests\/(?:isolated|gc|emulator|fuzz|recovery|hardening|stress)\//.test(file)
        || /(?:challenger_|adversarial|stress).*\.test\./.test(file))) {
        errors.push(area + ': generic runner mismatch ' + file);
      }
    }
    for (const target of Array.isArray(mutate) ? mutate : []) {
      const path = typeof target === 'string' ? target.replace(/:\d+-\d+$/, '') : '';
      if (!tracked.has(path)) errors.push(area + ': missing mutation target ' + String(target));
    }
  }
  return errors;
}
