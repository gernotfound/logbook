import { expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedCatalog, validateSeed } from '../../scripts/seed-catalog.mjs';
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
