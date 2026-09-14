import fs from 'node:fs';
import path from 'node:path';

const roots = ['src', 'tests'];
const skipped = [];
const testFilePattern = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const skipPattern = /\b(?:it|test|describe)\.skip\s*\(/g;

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
            if (skipPattern.test(line)) skipped.push(`${fullPath}:${index + 1}: ${line.trim()}`);
            skipPattern.lastIndex = 0;
        });
    }
}

for (const root of roots) walk(root);

if (skipped.length) {
    console.error('Skipped tests are not allowed in the Milestone 0 verification gate:');
    for (const item of skipped) console.error(`- ${item}`);
    process.exit(1);
}

console.log('No skipped tests found.');
