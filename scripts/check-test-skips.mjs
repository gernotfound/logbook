import fs from 'node:fs';
import path from 'node:path';

const roots = ['src', 'tests'];
const violations = [];
const testFilePattern = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const forbiddenPatterns = [
    { label: 'skip', pattern: /\b(?:it|test|describe)\.skip\s*\(/g },
    { label: 'todo', pattern: /\b(?:it|test)\.todo\s*\(/g },
    { label: 'only', pattern: /\b(?:it|test|describe)\.only\s*\(/g },
    { label: 'tautology', pattern: /expect\(true\)\.toBe\(true\)|expect\(false\)\.toBe\(false\)/g },
];

function walk(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            walk(fullPath);
            continue;
        }
        if (!testFilePattern.test(entry.name)) continue;

        const content = fs.readFileSync(fullPath, 'utf8');
        const lines = content.split(/\r?\n/);
        lines.forEach((line, index) => {
            for (const { label, pattern } of forbiddenPatterns) {
                if (pattern.test(line)) violations.push(`${fullPath}:${index + 1} [${label}]: ${line.trim()}`);
                pattern.lastIndex = 0;
            }
        });
    }
}

for (const root of roots) walk(root);

if (violations.length) {
    console.error('Forbidden test shortcuts are not allowed in the canonical verification gate:');
    for (const item of violations) console.error(`- ${item}`);
    process.exit(1);
}

console.log('No skipped, focused, todo, or tautological tests found.');
