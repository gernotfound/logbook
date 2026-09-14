import fs from 'node:fs';

const files = [
  'tests/logout_protection.test.ts',
  'tests/guest_bootstrap_lifecycle.test.tsx',
  'tests/guest_account_migration_v3.test.tsx',
  'tests/catalog_resolution_pipeline.test.ts',
  'tests/hardening/nutrition_guest_flow.test.tsx',
];

const forbidden = [
  { label: 'skipped/todo test', pattern: /\b(?:it|test|describe)\.(?:skip|todo)\s*\(/g },
  { label: 'tautology expect(true).toBe(true)', pattern: /expect\s*\(\s*true\s*\)\s*\.\s*toBe\s*\(\s*true\s*\)/g },
  { label: 'tautology expect(false).toBe(false)', pattern: /expect\s*\(\s*false\s*\)\s*\.\s*toBe\s*\(\s*false\s*\)/g },
  { label: 'placeholder marker', pattern: /\b(?:TODO|FIXME|placeholder)\b/gi },
];

const failures = [];

for (const file of files) {
  if (!fs.existsSync(file)) {
    failures.push(`${file}: file normativo M5 mancante`);
    continue;
  }

  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/);

  for (const { label, pattern } of forbidden) {
    lines.forEach((line, index) => {
      pattern.lastIndex = 0;
      if (pattern.test(line)) failures.push(`${file}:${index + 1}: ${label}: ${line.trim()}`);
    });
  }
}

if (failures.length) {
  console.error('M5 test-quality gate failed:');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`M5 test-quality gate passed for ${files.length} normative files.`);
