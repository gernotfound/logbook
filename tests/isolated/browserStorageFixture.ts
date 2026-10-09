// Browser origin-scoped storage fixture for isolated Node persistence tests.
// Preserve strict storage behavior: tests may override getItem to simulate failures.
const entries = new Map<string, string>();
const storage = {
  get length() { return entries.size; },
  clear() { entries.clear(); },
  getItem(key: string) { return entries.get(key) ?? null; },
  key(index: number) { return [...entries.keys()][index] ?? null; },
  removeItem(key: string) { entries.delete(key); },
  setItem(key: string, value: string) { entries.set(key, String(value)); },
};
Object.defineProperty(globalThis, 'localStorage', {
  value: storage,
  writable: true,
  configurable: true,
});
