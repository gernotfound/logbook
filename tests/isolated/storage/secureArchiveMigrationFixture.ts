import { clear } from 'idb-keyval';
import { vi } from 'vitest';
import { UserDataSchema } from '../../../src/lib/schema';
import type { UserData } from '../../../src/types';
import { lockAllVaults } from '../../../src/lib/sync/secureArchiveSession';

export const owner = 'user:secure-migration';
export const day = '2026-10-12';
export const base = (): UserData => UserDataSchema.parse({
    profile: { height: '170', gender: 'M' },
    nutrition: { [day]: { date: day, weight: 75, kcal: 0, pro: 0, carbs: 0, fat: 0, meals: [] } },
}) as unknown as UserData;

// Each split suite uses the same clean IDB, key-memory, storage, and Web Lock boundary.
export async function resetSecureArchiveMigrationFixture(): Promise<void> {
    lockAllVaults();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.stubGlobal('navigator', {
        locks: { request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run() },
    });
    await clear();
}
