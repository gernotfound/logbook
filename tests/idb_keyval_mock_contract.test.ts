import { describe, expect, it } from 'vitest';
import { get, set, del } from 'idb-keyval';
import { idbStore } from './setup';

describe('UI IndexedDB mock presence contract', () => {
  it('distinguishes a stored null from an absent key', async () => {
    const key = 'explicit-null-regression';
    expect(await get(key)).toBeUndefined();
    await set(key, null);
    expect(Object.prototype.hasOwnProperty.call(idbStore, key)).toBe(true);
    expect(await get(key)).toBeNull();
    await del(key);
    expect(await get(key)).toBeUndefined();
  });
});
