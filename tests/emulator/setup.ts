import { beforeEach, vi } from 'vitest';

let disk = new Map<string, string>();

beforeEach(() => {
  disk = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    get length() {
      return disk.size;
    },
    key(index: number) {
      return [...disk.keys()][index] ?? null;
    },
    getItem(key: string) {
      return disk.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      disk.set(key, String(value));
    },
    removeItem(key: string) {
      disk.delete(key);
    },
    clear() {
      disk.clear();
    },
  } satisfies Storage);
});
