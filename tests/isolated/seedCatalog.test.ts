import { expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedCatalog, validateSeed } from '../../scripts/seed-catalog.mjs';
const admin = vi.hoisted(() => ({
    initializeApp: vi.fn(),
    deleteApp: vi.fn(async () => {}),
    getFirestore: vi.fn(),
}));
vi.mock('firebase-admin/app', () => ({
    initializeApp: admin.initializeApp,
    deleteApp: admin.deleteApp,
    cert: vi.fn(),
}));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: admin.getFirestore }));

it('refuses empty seed before credentials and remote writes can be reached', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'logbook-seed-empty-'));
    try {
        await writeFile(join(directory, 'empty.json'), JSON.stringify([]));
        const args = ['--exercises=' + join(directory, 'empty.json'), '--foods=' + join(directory, 'empty.json')];
        await expect(seedCatalog([...args, '--dry-run'])).rejects.toThrow('seed vuoto');
        await expect(seedCatalog(args)).rejects.toThrow('seed vuoto');
    } finally {
        await rm(directory, { recursive: true });
    }
});

it('rejects invalid identities, duplicate IDs, missing macros and oversized documents', () => {
    expect(() => validateSeed([{ id: '', name: 'X' }], 'exercises')).toThrow('ID');
    expect(() => validateSeed([{ id: 0, name: 'X' }, { id: '0', name: 'Y' }], 'exercises')).toThrow('duplicato');
    expect(() => validateSeed([{ id: 'x', name: 'X', kcal: Infinity }], 'foods')).toThrow('macronutrienti');
    expect(() => validateSeed([{ id: 'x', name: 'X', notes: 'x'.repeat(800_000) }], 'exercises')).toThrow('troppo grande');
});
it('dry-runs synthetic input with an explicit target without initializing Firebase', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'logbook-seed-test-'));
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
        await writeFile(join(directory, 'exercises.json'), JSON.stringify([{ id: 'a', name: 'X' }]));
        await writeFile(join(directory, 'foods.json'), JSON.stringify([{ id: 0, name: 'Y', kcal: 100, pro: 0, carbs: 25, fat: 0 }]));
        const args = ['--project=demo-logbook-audit', '--version=test-1', '--exercises=' + join(directory, 'exercises.json'), '--foods=' + join(directory, 'foods.json')];
        await seedCatalog([...args, '--dry-run']);
        expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({ dryRun: true, project: 'demo-logbook-audit', manifest: { itemCounts: { exercises: 1, foods: 1 } } });
        await expect(seedCatalog(args)).rejects.toThrow('Scrittura non autorizzata');
        await expect(seedCatalog([...args, '--confirm=wrong-project'])).rejects.toThrow('Scrittura non autorizzata');
    } finally { output.mockRestore(); await rm(directory, { recursive: true }); }
});

it('publishes one catalog version with manifest last and archives the previous manifest in a mocked transaction', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'logbook-seed-txn-'));
    const printed = vi.spyOn(console, 'log').mockImplementation(() => {});
    const operations: string[] = [];
    const app = { name: 'catalog-transaction-test' };
    admin.initializeApp.mockReturnValue(app);
    const transaction = {
        get: vi.fn(async (ref: string) => {
            operations.push('get:' + ref);
            return { exists: true, data: () => ({ version: 'previous' }) };
        }),
        create: vi.fn((ref: string, value: unknown) => {
            operations.push('create:' + ref);
            expect(value).toBeDefined();
        }),
        set: vi.fn((ref: string, value: unknown) => {
            operations.push('set:' + ref);
            expect(value).toMatchObject({ version: 'test-2' });
        }),
    };
    const db = {
        collection: vi.fn((name: string) => ({ doc: (id: string) => name + '/' + id })),
        runTransaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<void>) => callback(transaction)),
    };
    admin.getFirestore.mockReturnValue(db);
    try {
        await writeFile(join(directory, 'exercises.json'), JSON.stringify([{ id: 'ex-1', name: 'Squat' }]));
        await writeFile(join(directory, 'foods.json'), JSON.stringify([{ id: 'food-1', name: 'Riso', kcal: 100, pro: 2, carbs: 20, fat: 1 }]));
        await seedCatalog([
            '--project=demo-logbook-audit', '--version=test-2',
            '--exercises=' + join(directory, 'exercises.json'),
            '--foods=' + join(directory, 'foods.json'),
            '--confirm=demo-logbook-audit',
        ]);
        expect(admin.initializeApp).toHaveBeenCalledWith({ projectId: 'demo-logbook-audit' });
        expect(operations).toEqual([
            'get:global_catalog/manifest',
            'create:global_catalog/exercises_test-2',
            'create:global_catalog/foods_test-2',
            'create:global_catalog/previous_manifest_test-2',
            'set:global_catalog/manifest',
        ]);
        expect(db.runTransaction).toHaveBeenCalledTimes(1);
        expect(admin.deleteApp).toHaveBeenCalledWith(app);
    } finally {
        printed.mockRestore();
        admin.initializeApp.mockReset();
        admin.getFirestore.mockReset();
        admin.deleteApp.mockClear();
        await rm(directory, { recursive: true });
    }
});
