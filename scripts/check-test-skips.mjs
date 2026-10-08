import fs from 'node:fs';
import path from 'node:path';

const roots = ['src', 'tests', 'e2e'];
const mockFileExtensions = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts', '.cjs', '.cts', '.json', '.css', '.scss', '.svg'];

function hasRealMockTarget(filePath, specifier) {
    const target = path.resolve(path.dirname(filePath), specifier.split(/[?#]/, 1)[0]);
    const isFile = candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    return mockFileExtensions.some(extension => isFile(target + extension)) ||
        mockFileExtensions.some(extension => isFile(path.join(target, 'index' + extension)));
}

function checkMockTargets(filePath, source) {
    // Only check static relative specifiers. Bare package names and generated virtual modules
    // are resolved by Vite/Vitest, so their filesystem existence is not a useful oracle.
    const mockPattern = /^[\uFEFF \t]*(?:vi|jest)\.(?:mock|doMock)\s*\(\s*(['"])(\.{1,2}\/[^'"\r\n]+)\1/gm;
    for (const match of source.matchAll(mockPattern)) {
        const specifier = match[2];
        if (!hasRealMockTarget(filePath, specifier)) {
            const line = source.slice(0, match.index).split('\n').length;
            violations.push(`${filePath}:${line} [nonexistent mocked module]: ${specifier}`);
        }
    }
}
const violations = [];
const testFilePattern = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const forbiddenPatterns = [
    { label: 'skip', pattern: /\b(?:it|test|describe)\.skip\s*\(/g },
    { label: 'todo', pattern: /\b(?:it|test|describe)\.todo\s*\(/g },
    { label: 'only', pattern: /\b(?:it|test|describe)\.only\s*\(/g },
    { label: 'tautology', pattern: /expect\s*\(\s*true\s*\)\s*\.\s*toBe\s*\(\s*true\s*\)|expect\s*\(\s*false\s*\)\s*\.\s*toBe\s*\(\s*false\s*\)/g },
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
        checkMockTargets(fullPath, content);
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
    console.error('Invalid test shortcuts or unresolved mocked modules in the canonical verification gate:');
    for (const item of violations) console.error(`- ${item}`);
    process.exit(1);
}

console.log('No skipped, focused, todo, tautological, or unresolved relative mocked modules found.');
