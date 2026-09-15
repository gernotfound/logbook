from pathlib import Path


def replace_exact(path: str, old: str, new: str, expected: int = 1) -> None:
    file = Path(path)
    text = file.read_text(encoding='utf-8')
    count = text.count(old)
    if count != expected:
        raise SystemExit(f'{path}: expected {expected} occurrence(s), found {count}: {old!r}')
    file.write_text(text.replace(old, new), encoding='utf-8')


# NutritionMeals is now strongly typed: macro values are numbers and meal identity is id/time only.
for field in ('kcal', 'carbs', 'pro', 'fat'):
    replace_exact(
        'src/components/Nutrition/NutritionMeals.tsx',
        f'parseFloat(m.{field})',
        f'Number(m.{field})',
    )
replace_exact(
    'src/components/Nutrition/NutritionMeals.tsx',
    'parseFloat(item.kcal)',
    'Number(item.kcal)',
)
replace_exact(
    'src/components/Nutrition/NutritionMeals.tsx',
    'removeFood(item.itemId || item.time || item.id);',
    'removeFood(item.time ?? item.id);',
)

old_patch = '''function applyPatch<T extends Record<string, unknown>>(target: T, patch: Partial<T>): T {
    const result = { ...target };
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete result[key];
        else result[key] = value;
    }
    return result;
}'''
new_patch = '''function applyPatch<T extends object>(target: T, patch: Partial<T>): T {
    const result = { ...target } as T;
    for (const key of Object.keys(patch) as Array<keyof T>) {
        const value = patch[key];
        if (value === undefined) Reflect.deleteProperty(result, key);
        else Object.assign(result, { [key]: value });
    }
    return result;
}'''
replace_exact('src/lib/sync/domainOperations.ts', old_patch, new_patch)
replace_exact(
    'src/lib/sync/domainOperations.ts',
    'const patched = applyPatch(day as unknown as Record<string, unknown>, operation.patch as Record<string, unknown>) as unknown as NutritionDay;',
    'const patched = applyPatch<NutritionDay>(day, operation.patch);',
)

test_path = Path('tests/m8_domain_operations.test.ts')
test_text = test_path.read_text(encoding='utf-8')
marker = '''    it('rejects an incomplete reorder instead of silently dropping an entity', () => {
        const before = base({ supplements: [
            { id: 's1', name: 'A', unit: 'g' },
            { id: 's2', name: 'B', unit: 'g' },
        ] });
        expect(() => applyDomainOperations(before, { type: 'supplement.reorder', ids: ['s1'] })).toThrow(/esattamente/i);
    });
});
'''
replacement = '''    it('rejects an incomplete reorder instead of silently dropping an entity', () => {
        const before = base({ supplements: [
            { id: 's1', name: 'A', unit: 'g' },
            { id: 's2', name: 'B', unit: 'g' },
        ] });
        expect(() => applyDomainOperations(before, { type: 'supplement.reorder', ids: ['s1'] })).toThrow(/esattamente/i);
    });

    it('treats undefined in a patch as property deletion and emits a semantic tombstone', () => {
        const before = base({ profile: { height: '170', waist: '80' } });
        const { after, operations, replay } = compile(before, { type: 'profile.patch', patch: { waist: undefined } });

        expect(Object.hasOwn(after.profile ?? {}, 'waist')).toBe(false);
        expect(operations).toContainEqual(expect.objectContaining({ path: ['profile', 'waist'], isDelete: true }));
        expect(Object.hasOwn((replay.get('')?.profile as Record<string, unknown>) ?? {}, 'waist')).toBe(false);
    });

    it('keeps the exercise archive deterministically sorted after an upsert', () => {
        const before = base({ library: [
            { id: 'e-z', name: 'Zeta', setsCount: 3, sets: [] },
        ] });
        const { after } = compile(before, {
            type: 'exercise.upsert',
            exercise: { id: 'e-a', name: 'Alfa', setsCount: 3, sets: [] },
        });

        expect(after.library?.map(item => item.id)).toEqual(['e-a', 'e-z']);
    });
});
'''
if test_text.count(marker) != 1:
    raise SystemExit('tests/m8_domain_operations.test.ts: final marker not found exactly once')
test_path.write_text(test_text.replace(marker, replacement), encoding='utf-8')
